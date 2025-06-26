#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import BufferedCommandExecutor from "./BufferedCommandExecutor.js";
import SendControlCharacter from "./SendControlCharacter.js";
// Create a shared instance of BufferedCommandExecutor
const bufferedExecutor = new BufferedCommandExecutor();
const server = new Server({
    name: "iterm-mcp",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "execute_command",
                description: "Executes a command in the iTerm terminal and returns the output immediately. This combines write and read operations for better performance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                            description: "The command to execute in the terminal"
                        },
                        returnFullOutput: {
                            type: "boolean",
                            description: "If true, returns the full terminal buffer. If false (default), returns only the command output.",
                            default: false
                        }
                    },
                    required: ["command"]
                }
            },
            {
                name: "send_control_character",
                description: "Sends a control character to the active iTerm terminal (e.g., Control-C, or special sequences like ']' for telnet escape)",
                inputSchema: {
                    type: "object",
                    properties: {
                        letter: {
                            type: "string",
                            description: "The letter corresponding to the control character (e.g., 'C' for Control-C, ']' for telnet escape)"
                        },
                    },
                    required: ["letter"]
                }
            },
            {
                name: "execute_command_async",
                description: "Starts executing a command without waiting for completion. Use read_streaming_output to get the output.",
                inputSchema: {
                    type: "object",
                    properties: {
                        command: {
                            type: "string",
                            description: "The command to execute asynchronously"
                        }
                    },
                    required: ["command"]
                }
            },
            {
                name: "read_streaming_output",
                description: "Reads any new output from an async command execution. Returns the new output and whether the command is complete.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            }
        ]
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "execute_command": {
            const command = String(request.params.arguments?.command);
            const returnFullOutput = Boolean(request.params.arguments?.returnFullOutput);
            try {
                const result = await bufferedExecutor.executeCommand(command);
                return {
                    content: [{
                            type: "text",
                            text: returnFullOutput ? (result.fullBuffer || result.output) : result.output
                        }]
                };
            }
            catch (error) {
                // If there's unread output, return it with the error message
                if (error instanceof Error && error.message.includes("Unread output detected")) {
                    return {
                        content: [{
                                type: "text",
                                text: error.message
                            }]
                    };
                }
                throw error;
            }
        }
        case "send_control_character": {
            const ttyControl = new SendControlCharacter();
            const letter = String(request.params.arguments?.letter);
            await ttyControl.send(letter);
            return {
                content: [{
                        type: "text",
                        text: `Sent control character: Control-${letter.toUpperCase()}`
                    }]
            };
        }
        case "execute_command_async": {
            const command = String(request.params.arguments?.command);
            try {
                await bufferedExecutor.executeCommandAsync(command);
                return {
                    content: [{
                            type: "text",
                            text: "Command execution started. Use read_streaming_output to get the output."
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to start async command: ${error.message}`);
            }
        }
        case "read_streaming_output": {
            try {
                const result = await bufferedExecutor.readNewOutput();
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                output: result.output,
                                isComplete: result.isComplete
                            }, null, 2)
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to read streaming output: ${error.message}`);
            }
        }
        default:
            throw new Error("Unknown tool");
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
