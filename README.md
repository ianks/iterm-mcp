# iterm-mcp 
A Model Context Protocol server that provides access to your iTerm session.

![Main Image](.github/images/demo.gif)

> **Fork Notice**: This is @ianks's fork with enhanced command execution features. Install with:
> ```bash
> npx github:ianks/iterm-mcp#main iterm-mcp
> ```

### Features

**Efficient Token Use:** iterm-mcp gives the model the ability to inspect only the output that the model is interested in. The model typically only wants to see the last few lines of output even for long running commands. 

**Natural Integration:** You share iTerm with the model. You can ask questions about what's on the screen, or delegate a task to the model and watch as it performs each step.

**Full Terminal Control and REPL support:** The model can start and interact with REPL's as well as send control characters like ctrl-c, ctrl-z, etc.

**Easy on the Dependencies:** iterm-mcp is built with minimal dependencies and is runnable via npx. It's designed to be easy to add to Claude Desktop and other MCP clients. It should just work.

### Fork Enhancements

This fork adds several improvements to command execution:

- **Buffered Command Execution**: Intelligent buffering system that tracks unread output between commands
- **Synchronous Command Execution**: New `execute_command` tool that combines write and read operations for better performance
- **Streaming Output Support**: Async command execution with `execute_command_async` and `read_streaming_output` for long-running commands
- **Better Output Management**: Prevents output loss between rapid command executions by detecting and preserving unread content


## Safety Considerations

* The user is responsible for using the tool safely.
* No built-in restrictions: iterm-mcp makes no attempt to evaluate the safety of commands that are executed.
* Models can behave in unexpected ways. The user is expected to monitor activity and abort when appropriate.
* For multi-step tasks, you may need to interrupt the model if it goes off track. Start with smaller, focused tasks until you're familiar with how the model behaves. 

### Tools
- `execute_command` - **NEW: Recommended for most use cases.** Executes a command and returns the output immediately, combining write and read operations for better performance.
- `execute_command_async` - Starts executing a command without waiting for completion. Useful for long-running commands.
- `read_streaming_output` - Reads new output from an async command execution. Returns the output and completion status.
- `send_control_character` - Sends a control character to the active iTerm terminal.

### Requirements

* iTerm2 must be running
* Node version 18 or greater


## Installation

To use with Claude Desktop, add the server config:

On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "iterm-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "github:ianks/iterm-mcp#main"
      ]
    }
  }
}
```

### Installing via Smithery

To install iTerm for Claude Desktop automatically via [Smithery](https://smithery.ai/server/iterm-mcp):

```bash
npx -y @smithery/cli install iterm-mcp --client claude
```
[![smithery badge](https://smithery.ai/badge/iterm-mcp)](https://smithery.ai/server/iterm-mcp)

## Development

Install dependencies:
```bash
yarn install
```

Build the server:
```bash
yarn run build
```

For development with auto-rebuild:
```bash
yarn run watch
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
yarn run inspector
yarn debug <command>
```

The Inspector will provide a URL to access debugging tools in your browser.
