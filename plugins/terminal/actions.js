const MAX_ROWS = 200;
const MAX_HISTORY = 50;
let sequence = 0;

function line(kind, text) {
  return { id: `${Date.now().toString(36)}-${(++sequence).toString(36)}`, kind, text };
}

function append(output, ...rows) {
  return [...output, ...rows].slice(-MAX_ROWS);
}

export const actions = {
  "terminal.run": {
    async run({ command, cwd, output, history }, { api, read, write, status }) {
      command = command.trim();
      write({
        command: "",
        output: append(output, line("command", command)),
        history: [...history.filter((one) => one !== command), command].slice(-MAX_HISTORY),
      });
      status("terminal.status.running", { command });
      try {
        const result = await api.shell.run(command, { cwd: cwd || undefined });
        const rows = [];
        if (result.stdout) rows.push(line("stdout", result.stdout.replace(/\n+$/, "")));
        if (result.stderr) rows.push(line("stderr", result.stderr.replace(/\n+$/, "")));
        status("terminal.status.exit", { code: result.exit_code, cwd: result.cwd });
        // Clear may have run while the shell was waiting.
        return { output: append(read("output"), ...rows), cwd: result.cwd };
      } catch (error) {
        write({ output: append(read("output"), line("stderr", error.message || String(error))) });
        throw error;
      }
    },
  },
};
