<img width="180" height="120" alt="dusttext logosmallest" src="https://github.com/user-attachments/assets/8548d4dd-6d34-44d6-8016-e3da2efaf1a0" />

**DIVE into a text based MUD of yore, updated to the modern onchain DUST world. Energy is conserved. Death comes quick. So walk around and explore the beauty of the DUST world.  All through a custom narrative lens of biomes and terrain. Now insert an LLM for AI COOP gaming!** 

[![COOP mode demo](https://img.youtube.com/vi/AUYvukfKF5I/0.jpg)](https://www.youtube.com/watch?v=AUYvukfKF5I)

** Only deposit small amounts of ETH into the smart contract wallet at a time. There is NO reason to deposit large sums. This is an in-production open source engine, the engine builders receive no compensation. You are responsible for retrieving any lost sums.

### DUST + EntryKit + Quarry + Bundler Architecture Overview
** 🔑 Wallets and Session Keys **

* **EOA Wallet** (e.g. MetaMask)

  * User connects with wallet once.
  * Approves session key via signature (off-chain or via `createSession(...)`).

* **Session Key**

  * A separate ephemeral private key, stored client-side.
  * Authorized by EOA to sign `UserOperations` on their behalf.
  * Used for automated gameplay actions like `move`, `jump`, etc.

---

### ⚙️ Smart Contract Wallet (SCW) = Gas Handler

* Required by ERC-4337: all `UserOperations` are executed via a Smart Contract Wallet.
* SCW validates the session key during `validateUserOp()`.
* Delegates actual execution to game systems/contracts.

---

### 🚛 Bundler

* Redstone now runs a bundler at `https://rpc.redstonechain.com`.
* Bundler:

  * Receives the signed `UserOperation`
  * Simulates it
  * Forwards it to the EntryPoint if valid

---

### ⛽ Quarry Paymaster

* Separate from the SCW
* Validates whether the user has prepaid gas in a Quarry balance
* Deducts gas on operation approval
* Interacts with both the EntryPoint and the game logic

---

### 🧰 EntryKit Overview

* EntryKit is a frontend developer toolkit for interacting with ERC-4337 smart accounts.
* It abstracts away complex parts of account abstraction:

  * Smart account deployment and connection
  * Session signer generation and registration
  * UserOperation construction and submission
  * Bundler and Quarry Paymaster integration
* EntryKit powers `signAndSendUserOperation()` and smart account UX, enabling gasless session-based gameplay.

---

### 🧾 UserOperation Flow Summary

1. Session key signs a `UserOperation` (e.g., move packed direction).
2. Bundler receives and simulates the op.
3. Bundler forwards to `EntryPoint.handleOps()`.
4. EntryPoint calls:

   * `SCW.validateUserOp()` → session key validated
   * `QuarryPaymaster.validatePaymasterUserOp()` → checks gas balance
5. If valid, SCW delegates `execute()` to Dust contracts.
6. Game state updates.

---

### 🧠 Trust + Security

* The session key is only authorized to call game systems
* All logic enforcing expiration/scope lives in the SCW's validation module
* Gas limits are bounded by Quarry balance
* SCW **does not hold assets** — it's a conduit for game execution and gas handling

---

### ✅ Minimum Open Source Expectations

To build trust, open source:

* Session key validator contract (validation module)
* Message formats or signing payloads
* Gas deposit logic (Quarry integration)
* Game system whitelisting logic

---

This stack allows fully gas-abstracted, session-based gameplay on Dust — using smart accounts only for coordination, not custody.
