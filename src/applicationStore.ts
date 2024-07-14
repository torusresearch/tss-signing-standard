import BN from "bn.js";

// This is all the application would need to store for basic tss signing.

export const sapphire_network = "sapphire_devnet";
export const serviceProviderPostboxKey = "3f8113c84116a67a92f6c5c65e800b3b5b0addc4defbd722da1a998a564408db";
export const verifier = "torus-test-health";
export const verifierId = "y6i3nw2ki3@example.com";
export const parties = 4;
// Note: If RSS is used or if new factors, tags, etc are created, this would need to be updated from here.
export const deviceTSSShare = new BN("cd6b6025c9086a421ae3bb5e4e8ffe2c63d5fd217ac2ad3639819eb47300f07b","hex");
export const deviceTSSIndex = 3;
export const factorKey = new BN("1589b92678de8c83aebdd06257ab60c8904857adf895d5ab5d29700e49dacd63", "hex");