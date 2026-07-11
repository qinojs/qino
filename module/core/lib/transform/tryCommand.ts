/** True when `cmd` exists and exits 0. A missing binary throws synchronously from `output()`. */
export async function tryCommand(cmd: string, args: string[]): Promise<boolean> {
  try { return (await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped' }).output()).code === 0; }
  catch { return false; }
}
