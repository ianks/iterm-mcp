import CommandExecutor from './CommandExecutor.js';
import TtyOutputReader from './TtyOutputReader.js';

interface PendingCommand {
  command: string;
  timestamp: number;
  beforeBuffer?: string;
}

interface BufferState {
  lastRead: string;
  lastReadTimestamp: number;
  unreadOutput: boolean;
}

/**
 * BufferedCommandExecutor provides intelligent buffering and debouncing
 * for terminal commands, allowing for more efficient output retrieval.
 */
class BufferedCommandExecutor {
  private executor: CommandExecutor;
  private bufferState: BufferState;
  private pendingCommand: PendingCommand | null = null;
  private debounceMs: number = 50; // Debounce time for rapid commands

  constructor() {
    this.executor = new CommandExecutor();
    this.bufferState = {
      lastRead: '',
      lastReadTimestamp: 0,
      unreadOutput: false
    };
  }

  /**
   * Executes a command with intelligent buffering and output tracking.
   * If there's unread output from a previous command, it will throw an error
   * and return the unread output.
   */
  async executeCommand(command: string, options?: { forceExecute?: boolean }): Promise<{
    output: string;
    fullBuffer?: string;
    hasUnreadOutput?: boolean;
    unreadOutput?: string;
  }> {
    // Check if there's unread output from a previous command
    if (this.bufferState.unreadOutput && !options?.forceExecute) {
      const currentBuffer = await TtyOutputReader.retrieveBuffer();
      const unreadOutput = this.extractNewOutput(this.bufferState.lastRead, currentBuffer);
      
      // Mark as read now
      this.bufferState.lastRead = currentBuffer;
      this.bufferState.lastReadTimestamp = Date.now();
      this.bufferState.unreadOutput = false;
      
      throw new Error(`Unread output detected from previous command. Output:\n${unreadOutput}`);
    }

    // Get the buffer state before executing
    const beforeBuffer = await TtyOutputReader.retrieveBuffer();
    
    // Execute the command - this now includes better synchronization
    const afterBuffer = await this.executor.executeCommand(command);
    
    // Extract the command output
    const output = this.extractNewOutput(beforeBuffer, afterBuffer);
    
    // Update buffer state
    this.bufferState.lastRead = afterBuffer;
    this.bufferState.lastReadTimestamp = Date.now();
    this.bufferState.unreadOutput = false;
    
    return {
      output,
      fullBuffer: afterBuffer,
      hasUnreadOutput: false
    };
  }

  /**
   * Executes a command without waiting for completion.
   * Useful for long-running commands where you want to check output periodically.
   */
  async executeCommandAsync(command: string): Promise<void> {
    // Mark that we have pending unread output
    this.bufferState.unreadOutput = true;
    
    // Store the current buffer state
    const beforeBuffer = await TtyOutputReader.retrieveBuffer();
    this.pendingCommand = {
      command,
      timestamp: Date.now(),
      beforeBuffer
    };
    
    // Execute without waiting
    this.executor.executeCommand(command).catch(() => {
      // Ignore errors for async execution
    });
  }

  /**
   * Reads any new output since the last read operation.
   * This can be called multiple times to get streaming output.
   */
  async readNewOutput(): Promise<{
    output: string;
    isComplete: boolean;
  }> {
    const currentBuffer = await TtyOutputReader.retrieveBuffer();
    const newOutput = this.extractNewOutput(this.bufferState.lastRead, currentBuffer);
    
    // Update the last read state
    this.bufferState.lastRead = currentBuffer;
    this.bufferState.lastReadTimestamp = Date.now();
    
    // Check if the command is still running by seeing if the buffer is still changing
    const isComplete = await this.isCommandComplete();
    
    if (isComplete) {
      this.bufferState.unreadOutput = false;
      this.pendingCommand = null;
    }
    
    return {
      output: newOutput,
      isComplete
    };
  }

  /**
   * Checks if there's any unread output available.
   */
  async hasUnreadOutput(): Promise<boolean> {
    if (!this.bufferState.unreadOutput) {
      return false;
    }
    
    const currentBuffer = await TtyOutputReader.retrieveBuffer();
    return currentBuffer !== this.bufferState.lastRead;
  }

  /**
   * Gets all unread output without marking it as read.
   */
  async peekUnreadOutput(): Promise<string | null> {
    if (!this.bufferState.unreadOutput) {
      return null;
    }
    
    const currentBuffer = await TtyOutputReader.retrieveBuffer();
    return this.extractNewOutput(this.bufferState.lastRead, currentBuffer);
  }

  /**
   * Extracts new output by comparing before and after buffers.
   */
  private extractNewOutput(beforeBuffer: string, afterBuffer: string): string {
    // Handle empty before buffer
    if (!beforeBuffer) {
      return afterBuffer;
    }
    
    // If buffers are identical, no new output
    if (beforeBuffer === afterBuffer) {
      return '';
    }
    
    // If after buffer is shorter, something went wrong
    if (afterBuffer.length < beforeBuffer.length) {
      return '';
    }
    
    // Simple case: after buffer has content appended to before buffer
    if (afterBuffer.startsWith(beforeBuffer)) {
      return afterBuffer.substring(beforeBuffer.length);
    }
    
    // More complex case: need to find where they diverge
    const beforeLines = beforeBuffer.split('\n');
    const afterLines = afterBuffer.split('\n');
    
    // Find the first line that differs
    let firstDifferentLine = -1;
    for (let i = 0; i < beforeLines.length && i < afterLines.length; i++) {
      if (beforeLines[i] !== afterLines[i]) {
        firstDifferentLine = i;
        break;
      }
    }
    
    // If no differences found in common lines, new content is after the before buffer
    if (firstDifferentLine === -1) {
      if (afterLines.length > beforeLines.length) {
        return afterLines.slice(beforeLines.length).join('\n');
      }
      return '';
    }
    
    // Check if the different line was partially appended to
    const lastMatchingLine = firstDifferentLine > 0 ? firstDifferentLine - 1 : -1;
    if (lastMatchingLine >= 0 && firstDifferentLine < beforeLines.length) {
      const beforeLine = beforeLines[firstDifferentLine];
      const afterLine = afterLines[firstDifferentLine];
      
      if (afterLine.startsWith(beforeLine)) {
        // Line was appended to
        const appendedContent = afterLine.substring(beforeLine.length);
        const remainingLines = afterLines.slice(firstDifferentLine + 1);
        
        if (appendedContent || remainingLines.length > 0) {
          return appendedContent + (remainingLines.length > 0 ? '\n' + remainingLines.join('\n') : '');
        }
      }
    }
    
    // Return everything from the first different line onward
    return afterLines.slice(firstDifferentLine).join('\n');
  }

  /**
   * Checks if a command has completed execution.
   */
  private async isCommandComplete(): Promise<boolean> {
    // Wait a bit to ensure the buffer has settled
    await new Promise(resolve => setTimeout(resolve, this.debounceMs));
    
    const buffer1 = await TtyOutputReader.retrieveBuffer();
    await new Promise(resolve => setTimeout(resolve, this.debounceMs));
    const buffer2 = await TtyOutputReader.retrieveBuffer();
    
    // If buffer hasn't changed, command is likely complete
    return buffer1 === buffer2;
  }
}

export default BufferedCommandExecutor;