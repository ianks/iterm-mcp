import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { basename } from 'path';
const execAsync = promisify(exec);
class ProcessTracker {
    shellNames = new Set(['bash', 'zsh', 'sh', 'fish', 'csh', 'tcsh']);
    replNames = new Set([
        'irb', 'pry', 'rails', 'node', 'python', 'ipython',
        'scala', 'ghci', 'iex', 'lein', 'clj', 'julia', 'R', 'php', 'lua'
    ]);
    /**
     * Get the active process and its resource usage in an iTerm tab
     */
    async getActiveProcess(ttyPath) {
        try {
            if (!existsSync(ttyPath)) {
                throw new Error(`TTY path does not exist: ${ttyPath}`);
            }
            const ttyName = basename(ttyPath);
            const processes = await this.getProcessesForTTY(ttyName);
            if (!processes.length) {
                return null;
            }
            const fgPgid = await this.getForegroundProcessGroup(ttyName);
            if (!fgPgid) {
                return null;
            }
            // Get all processes in the foreground process group
            const fgProcesses = processes.filter(p => p.pgid === fgPgid);
            if (!fgProcesses.length) {
                return null;
            }
            const activeProcess = this.findMostInterestingProcess(fgProcesses);
            const commandChain = this.buildCommandChain(activeProcess, processes);
            const { environment, applicationContext } = this.detectEnvironment(activeProcess, processes);
            // Build the process tree and calculate metrics
            const metrics = this.calculateProcessMetrics(activeProcess, processes);
            return {
                pid: activeProcess.pid,
                ppid: activeProcess.ppid,
                pgid: activeProcess.pgid,
                name: this.getProcessName(activeProcess.command),
                command: activeProcess.command,
                state: activeProcess.state,
                commandChain,
                environment,
                applicationContext,
                metrics
            };
        }
        catch (error) {
            return null;
        }
    }
    /**
     * Get all processes associated with a TTY including resource usage
     */
    async getProcessesForTTY(ttyName) {
        try {
            // Include CPU%, memory, and accumulated CPU time in the output
            const { stdout } = await execAsync(`ps -t ${ttyName} -o pid,ppid,pgid,sess,state,%cpu,rss,time,command -w`);
            const lines = stdout.trim().split('\n');
            if (lines.length < 2) {
                return [];
            }
            const processes = [];
            const processByPid = {};
            // Parse all processes (skip header line)
            for (const line of lines.slice(1)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 9) {
                    const process = {
                        pid: parts[0],
                        ppid: parts[1],
                        pgid: parts[2],
                        sess: parts[3],
                        state: parts[4],
                        cpuPercent: parseFloat(parts[5]),
                        memory: parts[6], // RSS in KB
                        time: parts[7], // Accumulated CPU time
                        command: parts.slice(8).join(' '),
                        children: []
                    };
                    processes.push(process);
                    processByPid[process.pid] = process;
                }
            }
            // Build process tree
            for (const process of processes) {
                const parent = processByPid[process.ppid];
                if (parent) {
                    parent.children.push(process);
                }
            }
            return processes;
        }
        catch (error) {
            console.error('Error getting processes:', error);
            return [];
        }
    }
    /**
     * Get the foreground process group ID for a TTY
     */
    async getForegroundProcessGroup(ttyName) {
        try {
            const { stdout } = await execAsync(`bash -c 'ps -o pgid= -t ${ttyName} | head -n1'`);
            return stdout.trim();
        }
        catch {
            return null;
        }
    }
    /**
     * Detect the environment and context of the process
     */
    detectEnvironment(process, allProcesses) {
        const cmd = process.command.toLowerCase();
        const cmdParts = cmd.split(/\s+/);
        const name = this.getProcessName(process.command).toLowerCase();
        // Check for Rails console
        if (cmd.includes('rails console') || (name === 'ruby' && cmd.includes('rails server'))) {
            // Try to extract Rails environment and app name
            const envMatch = cmd.match(/RAILS_ENV=(\w+)/);
            const appNameMatch = process.command.match(/\/([^/]+)\/config\/environment/);
            const environment = 'Rails Console';
            const railsEnv = envMatch?.[1] || 'development';
            const appName = appNameMatch?.[1] || 'Rails App';
            return {
                environment,
                applicationContext: `${appName} (${railsEnv})`
            };
        }
        // Check for other REPLs
        if (this.replNames.has(name)) {
            const replMap = {
                'irb': 'Ruby IRB',
                'pry': 'Pry Console',
                'node': 'Node.js REPL',
                'python': 'Python REPL',
                'ipython': 'IPython Console'
            };
            return {
                environment: replMap[name] || `${name.toUpperCase()} REPL`
            };
        }
        // Check for package managers
        if (name === 'brew' || name === 'npm' || name === 'yarn' || name === 'pip') {
            return {
                environment: `${name.charAt(0).toUpperCase() + name.slice(1)} Package Manager`
            };
        }
        return {};
    }
    /**
     * Find the most interesting process from a list of processes
     */
    findMostInterestingProcess(processes) {
        return processes.reduce((best, current) => {
            const bestScore = this.calculateProcessScore(best);
            const currentScore = this.calculateProcessScore(current);
            return currentScore > bestScore ? current : best;
        }, processes[0]);
    }
    /**
     * Calculate how interesting a process is based on various factors
     */
    calculateProcessScore(process) {
        const cmdName = this.getProcessName(process.command);
        const cmd = process.command.toLowerCase();
        let score = 0;
        // Base scores for process state
        // 'R' (running) processes get 2 points, 'S' (sleeping) get 1 point
        score += process.state === 'R' ? 2 : process.state === 'S' ? 1 : 0;
        // CPU usage bonus
        // Add up to 5 points based on CPU usage percentage (1 point per 10%)
        score += Math.min(process.cpuPercent / 10, 5);
        // Penalize shell processes unless they're the only option
        // Shell processes are less interesting, so deduct 1 point
        if (this.shellNames.has(cmdName)) {
            score -= 1;
        }
        // Give high priority to REPL processes
        // Add 3 points for REPLY processes
        if (this.replNames.has(cmdName)) {
            score += 3;
        }
        // Bonus for active package manager operations
        // Add 2 points for package managers like 'brew', 'npm', or 'yarn' if they are using CPU
        if ((cmdName === 'brew' || cmdName === 'npm' || cmdName === 'yarn') &&
            process.cpuPercent > 0) {
            score += 2;
        }
        return score;
    }
    /**
     * Get the base process name from a command
     */
    getProcessName(command) {
        return basename(command.split(/\s+/)[0]);
    }
    /**
     * Build the command chain showing process hierarchy
     */
    buildCommandChain(process, allProcesses) {
        const processByPid = {};
        for (const p of allProcesses) {
            processByPid[p.pid] = p;
        }
        const chain = [];
        let current = process;
        const maxChainLength = 10;
        while (current && chain.length < maxChainLength) {
            const name = this.getProcessName(current.command);
            // Add context for special processes
            if (name === 'ruby' && current.command.includes('rails console')) {
                chain.push('rails console');
            }
            else if (name === 'brew' && current.command.includes('install')) {
                chain.push(`brew install ${current.command.split('install')[1].trim()}`);
            }
            else {
                chain.push(name);
            }
            current = processByPid[current.ppid];
        }
        return chain.reverse().join(' -> ');
    }
    /**
     * Calculate resource metrics for a process and all its descendants
     */
    calculateProcessMetrics(process, allProcesses) {
        // Get all descendant PIDs
        const descendants = this.getAllDescendants(process, allProcesses);
        const allRelatedProcesses = [process, ...descendants];
        // Calculate totals
        let totalCPUPercent = 0;
        let totalMemoryMB = 0;
        const processBreakdown = [];
        for (const proc of allRelatedProcesses) {
            const cpuPercent = proc.cpuPercent;
            const memoryMB = this.parseMemoryString(proc.memory);
            totalCPUPercent += cpuPercent;
            totalMemoryMB += memoryMB;
            // Only include in breakdown if using significant resources
            if (cpuPercent > 0.1 || memoryMB > 5) {
                processBreakdown.push({
                    name: this.getProcessName(proc.command),
                    pid: proc.pid,
                    cpuPercent: cpuPercent,
                    memory: proc.memory
                });
            }
        }
        // Sort breakdown by CPU usage
        processBreakdown.sort((a, b) => b.cpuPercent - a.cpuPercent);
        return {
            totalCPUPercent,
            totalMemoryMB,
            processBreakdown
        };
    }
    /**
     * Get all descendant processes of a given process
     */
    getAllDescendants(process, allProcesses) {
        const descendants = [];
        const processByPid = {};
        // Build lookup table
        for (const p of allProcesses) {
            processByPid[p.pid] = p;
        }
        // Recursive function to collect descendants
        const collect = (proc) => {
            const children = allProcesses.filter(p => p.ppid === proc.pid);
            for (const child of children) {
                descendants.push(child);
                collect(child);
            }
        };
        collect(process);
        return descendants;
    }
    /**
     * Parse memory string (KB) to MB
     */
    parseMemoryString(memory) {
        const kb = parseInt(memory, 10);
        return kb / 1024; // Convert KB to MB
    }
}
// Example usage
async function main() {
    const tracker = new ProcessTracker();
    const ttyPath = '/dev/ttys001'; // Example TTY path
    const process = await tracker.getActiveProcess(ttyPath);
    if (process) {
        console.log('Active process:');
        console.log(`  Name: ${process.name}`);
        console.log(`  Command: ${process.command}`);
        console.log(`  Command Chain: ${process.commandChain}`);
        if (process.environment) {
            console.log(`  Environment: ${process.environment}`);
        }
        console.log('\nResource Usage:');
        console.log(`  Total CPU: ${process.metrics.totalCPUPercent.toFixed(1)}%`);
        console.log(`  Total Memory: ${process.metrics.totalMemoryMB.toFixed(1)} MB`);
        if (process.metrics.processBreakdown.length > 0) {
            console.log('\nProcess Breakdown:');
            for (const proc of process.metrics.processBreakdown) {
                console.log(`  ${proc.name} (${proc.pid}):`);
                console.log(`    CPU: ${proc.cpuPercent.toFixed(1)}%`);
                console.log(`    Memory: ${proc.memory} KB`);
            }
        }
    }
    else {
        console.log('No active process found');
    }
}
export default ProcessTracker;
