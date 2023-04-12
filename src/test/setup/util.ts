import { until } from "@eng-automation/js";
import { ChildProcess } from "child_process";
import net from "net";

/**
 * As we need to find unused ports for our bot, we also need to know them in the test environment,
 *  which means that we can't just let bot listen on port 0,
 *  because we don't have a proper backchannel to understand which ports are used
 *
 *  This function spawns net.servers on port 0, gets, which ports they used, and frees it.
 *  Unlike using port 0, this approach doesn't really guarantee that port will be free until app starts listening,
 *  but should be pretty stable
 *
 *  A caveat here: if you free a port and try getting a new one in a row, you might get the same one,
 *  thus, spawning multiple servers together, and closing them together as well
 */
export async function findFreePorts(amount: number): Promise<number[]> {
  const servers: net.Server[] = [];

  while (servers.length < amount) {
    servers.push(net.createServer());
  }
  const ports = await Promise.all(
    servers.map(
      (srv) =>
        new Promise<number>((res, rej) =>
          srv.listen(0, () => {
            const addr = srv.address();
            if (addr === null || typeof addr === "string") {
              rej(addr);
            } else {
              res(addr.port);
            }
          }),
        ),
    ),
  );
  await Promise.all(servers.map((srv) => new Promise<void>((res) => srv.close(() => res()))));
  return ports;
}

export async function killAndWait(cp: ChildProcess): Promise<void> {
  const p = new Promise((resolve) => cp.on("exit", resolve));
  cp.kill();
  await Promise.race([until(() => cp.exitCode !== null, 100), p]);
}
