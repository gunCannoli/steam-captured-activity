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
    } else {
        console.log("  raw response:", JSON.stringify(resLufia));
    }

    console.log("\nProbing EnsureFresh for Dragon Ball Z: The Legacy of Goku (2371045769)...");
    const exprDBZ = `
        Millennium.callServerMethod("steam-cartridges-dev", "EnsureFresh", {
            payload: JSON.stringify({
                appid: 2371045769,
                parts: ["identity", "store", "metadata", "artwork", "media", "achievements"],
                context: { force: true }
            })
        }).then(raw => JSON.parse(raw))
    `;
    const resDBZ = await evalIn("SharedJSContext", exprDBZ);
    console.log("Dragon Ball Z EnsureFresh response status:");
    if (resDBZ?.parts) {
        console.log("  achievements:", resDBZ.parts.achievements?.status);
        console.log("  achievements schema total:", resDBZ.parts.achievements?.data?.schema?.total);
        console.log("  achievements title:", resDBZ.parts.achievements?.data?.schema?.title);
    } else {
        console.log("  raw response:", JSON.stringify(resDBZ));
    }

    console.log("\nProbing EnsureFresh for The Lion King (3840266850)...");
    const exprLion = `
        Millennium.callServerMethod("steam-cartridges-dev", "EnsureFresh", {
            payload: JSON.stringify({
                appid: 3840266850,
                parts: ["identity", "store", "metadata", "artwork", "media", "achievements"],
                context: { force: true }
            })
        }).then(raw => JSON.parse(raw))
    `;
    const resLion = await evalIn("SharedJSContext", exprLion);
    console.log("The Lion King EnsureFresh response status:");
    if (resLion?.parts) {
        console.log("  achievements:", resLion.parts.achievements?.status);
        console.log("  achievements schema total:", resLion.parts.achievements?.data?.schema?.total);
        console.log("  achievements title:", resLion.parts.achievements?.data?.schema?.title);
    } else {
        console.log("  raw response:", JSON.stringify(resLion));
    }
}

main().catch(console.error);
