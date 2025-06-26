import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execPromise = promisify(exec);
export default class TtyOutputReader {
    static async call(linesOfOutput) {
        const buffer = await this.retrieveBuffer();
        if (!linesOfOutput) {
            return buffer;
        }
        const lines = buffer.split('\n');
        return lines.slice(-linesOfOutput - 1).join('\n');
    }
    static async retrieveBuffer() {
        const ascript = `
      tell application "iTerm2"
        tell front window
          tell current session of current tab
            set numRows to number of rows
            set allContent to contents
            return allContent
          end tell
        end tell
      end tell
    `;
        const { stdout: finalContent } = await execPromise(`osascript -e '${ascript}'`);
        return finalContent.trim();
    }
}
