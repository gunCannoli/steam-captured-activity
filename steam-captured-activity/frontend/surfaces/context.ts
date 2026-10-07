// What every surface gets from the composition root: the safety net. Open (a fresh net) until index.tsx sets it.
import { createSafety, type Safety } from "../kernel/safety";

export let safety: Safety = createSafety();

export function setSafety(s: Safety): void {
    safety = s;
}
