import { evalIn } from "./cdp.mjs";

async function main() {
    console.log("Probing EnsureFresh for Kirby: Nightmare in Dream Land (2301220798)...");
    const exprKirby = `
        Millennium.callServerMethod("steam-cartridges-dev", "EnsureFresh", {
            payload: JSON.stringify({
                appid: 2301220798,
                parts: ["identity", "store", "metadata", "artwork", "media", "achievements"],
                context: { force: true }
            })
        }).then(raw => JSON.parse(raw))
    `;
    const resKirby = await evalIn("SharedJSContext", exprKirby);
    console.log("Kirby EnsureFresh response status:");
    if (resKirby?.parts) {
        console.log("  achievements:", resKirby.parts.achievements?.status);
        console.log("  achievements schema total:", resKirby.parts.achievements?.data?.schema?.total);
    } else {
        console.log("  raw response:", JSON.stringify(resKirby));
    }

    console.log("\nProbing EnsureFresh for Lufia II: Rise of the Sinistrals (4274469458)...");
    const exprLufia = `
        Millennium.callServerMethod("steam-cartridges-dev", "EnsureFresh", {
            payload: JSON.stringify({
                appid: 4274469458,
                parts: ["identity", "store", "metadata", "artwork", "media", "achievements"],
                context: { force: true }
            })
        }).then(raw => JSON.parse(raw))
    `;
    const resLufia = await evalIn("SharedJSContext", exprLufia);
    console.log("Lufia II EnsureFresh response status:");
    if (resLufia?.parts) {
        console.log("  achievements:", resLufia.parts.achievements?.status);
        console.log("  achievements schema total:", resLufia.parts.achievements?.data?.schema?.total);
        console.log("  achievements title:", resLufia.parts.achievements?.data?.schema?.title);
    } else {
        console.log("  raw response:", JSON.stringify(resLufia));
    }
}

main().catch(console.error);
