
import { toHex } from 'viem';
import { objectNamesById } from '../../objects';
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";
const INVENTORY_SLOT_TABLE = "InventorySlot";

// Use official Dust entity encoding
const BYTES_32_BITS = 256n;
const ENTITY_TYPE_BITS = 8n;
const ENTITY_ID_BITS = BYTES_32_BITS - ENTITY_TYPE_BITS;
const VEC3_BITS = 96n;

const EntityTypes = {
  Player: 0x01,
  Block: 0x03,
} as const;

function encode(entityType: number, data: bigint): `0x${string}` {
  return toHex((BigInt(entityType) << ENTITY_ID_BITS) | data, { size: 32 });
}

function packVec3([x, y, z]: [number, number, number]): bigint {
  const ux = BigInt(x >>> 0);
  const uy = BigInt(y >>> 0);
  const uz = BigInt(z >>> 0);
  return (ux << 64n) | (uy << 32n) | uz;
}

function encodeCoord(entityType: number, coord: [number, number, number]): `0x${string}` {
  const packedCoord = packVec3(coord);
  return encode(entityType, packedCoord << (ENTITY_ID_BITS - VEC3_BITS));
}

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}


function encodeBlock(coord: [number, number, number]): `0x${string}` {
  return encodeCoord(EntityTypes.Block, coord);
}

async function getPlayerPosition(entityId: `0x${string}`) {
  const query = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST", 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const result = await response.json();
  const rows = result?.result?.[0];
  
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const [columns, ...values] = rows;
  const position = values[0];
  if (!position) return null;

  return {
    x: Number(position[columns.indexOf("x")]),
    y: Number(position[columns.indexOf("y")]), 
    z: Number(position[columns.indexOf("z")])
  };
}

async function getBlockInventory(blockEntityId: `0x${string}`) {
  const query = `SELECT "slot", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner" = '${blockEntityId}'`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const result = await response.json();
  const rows = result?.result?.[0];
  
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const [columns, ...values] = rows;
  return values.map(row => ({
    slot: Number(row[columns.indexOf("slot")]),
    objectType: Number(row[columns.indexOf("objectType")]),
    amount: Number(row[columns.indexOf("amount")])
  }));
}

async function checkChestAccess(playerAddress: string, blockEntityId: `0x${string}`): Promise<boolean> {
  try {
    // Check if there's an access group for this chest (using correct table name)
    const groupQuery = `SELECT "groupId" FROM "dfprograms_1__EntityAccessGrou" WHERE "entityId"='${blockEntityId}'`;
    
    const response = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query: groupQuery }])
    });

    if (!response.ok) return true; // If query fails, assume no protection

    const result = await response.json();
    const rows = result?.result?.[0];
    
    if (!Array.isArray(rows) || rows.length < 2) {
      return true; // No access group = public chest
    }

    const groupId = rows[1][0] as string; // First data row, first column
    
    if (!groupId) return true;

    // Check if player is a member of this group (using correct table name)
    const playerEntityId = encodePlayerEntityId(playerAddress);
    const memberQuery = `SELECT "hasAccess" FROM "dfprograms_1__AccessGroupMembe" WHERE "groupId"='${groupId}' AND "member"='${playerEntityId}' AND "hasAccess"=true`;
    
    const memberResponse = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query: memberQuery }])
    });

    if (!memberResponse.ok) return false;

    const memberResult = await memberResponse.json();
    const memberRows = memberResult?.result?.[0];
    
    return Array.isArray(memberRows) && memberRows.length >= 2;
    
  } catch (error) {
    console.error('Access check failed:', error);
    return false;
  }
}

export class ChestCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      let position: { x: number, y: number, z: number };

      // Check if coordinates were provided as arguments
      if (args.length >= 3) {
        const x = parseInt(args[0], 10);
        const y = parseInt(args[1], 10);
        const z = parseInt(args[2], 10);
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: "❌ Invalid coordinates. Usage: chest [x y z]" 
          }));
          return;
        }
        
        position = { x, y, z };
      } else {
        // Use player's current position - look at block beneath player
        const playerEntityId = encodePlayerEntityId(context.address);
        const playerPos = await getPlayerPosition(playerEntityId);
        if (!playerPos) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: "❌ Could not determine your position" 
          }));
          return;
        }
        // Look at the block beneath the player (where chests are typically placed)
        position = { x: playerPos.x, y: playerPos.y - 1, z: playerPos.z };
      }

      const blockEntityId = encodeBlock([position.x, position.y, position.z]);
      
      const blockItems = await getBlockInventory(blockEntityId);
      
      if (blockItems.length === 0) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "📦 The chest is empty" 
        }));
      } else {
        const itemList = blockItems.map(item => {
          const objectName = objectNamesById[item.objectType] || `Unknown(${item.objectType})`;
          return `  Slot ${item.slot}: ${item.amount}x ${objectName}`;
        }).join('\n');

        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `📦 Chest contents at (${position.x}, ${position.y}, ${position.z}):\n${itemList}` 
        }));
      }

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `💡 Choose action: (1) Take from chest, (2) Place in chest, or 'none' to cancel:` 
      }));

      // Set up chest interaction state
      (globalThis as any).chestInteraction = {
        position,
        blockItems,
        blockEntityId,
        awaitingAction: true
      };

    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Chest inspection failed: ${String(error)}` 
      }));
    }
  }

  // Handle action selection (take or place)
  static async handleActionSelection(context: CommandContext, actionInput: string): Promise<void> {
    const chestState = (globalThis as any).chestInteraction;
    if (!chestState?.awaitingAction) return;

    if (actionInput.toLowerCase() === 'none') {
      delete (globalThis as any).chestInteraction;
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Chest interaction cancelled" 
      }));
      return;
    }

    if (actionInput === '1') {
      // Take from chest
      if (chestState.blockItems.length === 0) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Chest is empty. Nothing to take." 
        }));
        delete (globalThis as any).chestInteraction;
        return;
      }

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `💡 Enter slot number to take from (or 'none' to cancel):` 
      }));

      chestState.awaitingAction = false;
      chestState.awaitingTakeSlot = true;
      
    } else if (actionInput === '2') {
      // Place in chest - show player inventory (using exact same method as inventory.ts)
      try {
        // Use the same address resolution as inventory command
        const sessionClient = context.sessionClient;
        const sessionAddress = typeof sessionClient.account === 'string' 
          ? sessionClient.account 
          : (sessionClient.account as any)?.address || sessionClient.account;
        
        const entityId = encodePlayerEntityId(sessionAddress);
        console.log('Debug: Using sessionAddress:', sessionAddress);
        console.log('Debug: Encoded entityId:', entityId);
        
        const query = `SELECT "slot", "entityId", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner" = '${entityId}'`;
        console.log('Debug: Query:', query);
        
        const response = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();
        console.log('Debug: Full result:', result);
        const rows = result?.result?.[0];
        
        if (!Array.isArray(rows) || rows.length < 2) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: "❌ Your inventory is empty. Nothing to place." 
          }));
          delete (globalThis as any).chestInteraction;
          return;
        }

        const [columns, ...values] = rows;
        const items = values.map(row => Object.fromEntries(columns.map((col: string, i: number) => [col, row[i]])));
        
        const itemList = items.map(item => {
          const objectType = Number(item.objectType);
          const objectName = objectNamesById[objectType] || `Unknown(${objectType})`;
          const amount = item.amount || 1;
          return `  Slot ${item.slot}: ${amount}x ${objectName}`;
        }).join('\n');
        
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `📦 Your inventory:\n${itemList}\n\n💡 Enter slot number to place in chest (or 'none' to cancel):` 
        }));

        chestState.awaitingAction = false;
        chestState.awaitingPlaceSlot = true;
        chestState.playerItems = items;

      } catch (error) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Failed to get inventory: ${String(error)}` 
        }));
        delete (globalThis as any).chestInteraction;
      }
      
    } else {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Invalid choice. Enter (1) Take from chest, (2) Place in chest, or 'none' to cancel:` 
      }));
    }
  }

  // Handle chest slot selection for taking
  static async handleTakeSlotSelection(context: CommandContext, slotInput: string): Promise<void> {
    const chestState = (globalThis as any).chestInteraction;
    if (!chestState?.awaitingTakeSlot) return;

    if (slotInput.toLowerCase() === 'none') {
      delete (globalThis as any).chestInteraction;
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Chest interaction cancelled" 
      }));
      return;
    }

    const slot = parseInt(slotInput);
    const item = chestState.blockItems.find((item: any) => item.slot === slot);
    
    if (!item) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ No item in slot ${slot}. Try again or type 'none' to cancel.` 
      }));
      return;
    }

    const objectName = objectNamesById[item.objectType] || `Unknown(${item.objectType})`;
    
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `📦 How many ${objectName} to take? (max: ${item.amount}, or 'all'):` 
    }));
    
    chestState.awaitingTakeSlot = false;
    chestState.awaitingTakeAmount = true;
    chestState.selectedItem = item;
  }

  // Handle place slot selection
  static async handlePlaceSlotSelection(context: CommandContext, slotInput: string): Promise<void> {
    const chestState = (globalThis as any).chestInteraction;
    if (!chestState?.awaitingPlaceSlot) return;

    if (slotInput.toLowerCase() === 'none') {
      delete (globalThis as any).chestInteraction;
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Chest interaction cancelled" 
      }));
      return;
    }

    const slot = parseInt(slotInput);
    console.log('Debug: Looking for slot:', slot);
    console.log('Debug: Available playerItems:', chestState.playerItems);
    
    const item = chestState.playerItems?.find((item: any) => Number(item.slot) === slot);
    console.log('Debug: Found item:', item);
    
    if (!item) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ No item in slot ${slot}. Try again or type 'none' to cancel.` 
      }));
      return;
    }

    const objectName = objectNamesById[item.objectType] || `Unknown(${item.objectType})`;
    
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `📦 How many ${objectName} to place? (max: ${item.amount}, or 'all'):` 
    }));
    
    chestState.awaitingPlaceSlot = false;
    chestState.awaitingPlaceAmount = true;
    chestState.selectedItem = item;
  }

  // Handle amount selection for both taking and placing
  static async handleAmountSelection(context: CommandContext, amountInput: string): Promise<void> {
    const chestState = (globalThis as any).chestInteraction;
    if (!chestState?.awaitingTakeAmount && !chestState?.awaitingPlaceAmount) return;

    if (amountInput.toLowerCase() === 'none') {
      delete (globalThis as any).chestInteraction;
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: "❌ Chest interaction cancelled" 
      }));
      return;
    }

    const item = chestState.selectedItem;
    let amount: number;

    if (amountInput.toLowerCase() === 'all') {
      amount = item.amount;
    } else {
      amount = parseInt(amountInput);
      if (isNaN(amount) || amount <= 0 || amount > item.amount) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Invalid amount. Enter 1-${item.amount} or 'all':` 
        }));
        return;
      }
    }

    try {
      // Use session address for the transaction (who actually owns the items)
      const sessionClient = context.sessionClient;
      const sessionAddress = typeof sessionClient.account === 'string' 
        ? sessionClient.account 
        : (sessionClient.account as any)?.address || sessionClient.account;
      
      const playerEntityId = encodePlayerEntityId(sessionAddress);
      const objectName = objectNamesById[item.objectType] || `Unknown(${item.objectType})`;

      // Check if player has access to this chest using EOA address
      const hasAccess = await checkChestAccess(context.address, chestState.blockEntityId);
      if (!hasAccess) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `🔒 You don't have permission to access this chest. It may be privately owned.` 
        }));
        delete (globalThis as any).chestInteraction;
        return;
      }

      let data: `0x${string}`;
      let actionText: string;

      if (chestState.awaitingTakeAmount) {
        // Taking from chest to player
        data = encodeFunctionData({
          abi: IWorldAbi,
          functionName: 'transferAmounts',
          args: [
            playerEntityId,            // caller (player initiating)
            chestState.blockEntityId,  // from (chest)
            playerEntityId,            // to (player)
            [{ slot: item.slot, amount: amount }],
            '0x'
          ],
        });
        actionText = `📦 Took ${amount}x ${objectName} from chest`;
      } else {
        // Placing from player to chest
        data = encodeFunctionData({
          abi: IWorldAbi,
          functionName: 'transferAmounts',
          args: [
            playerEntityId,            // caller (player initiating)
            playerEntityId,            // from (player)
            chestState.blockEntityId,  // to (chest)
            [{ slot: item.slot, amount: amount }],
            '0x'
          ],
        });
        actionText = `📦 Placed ${amount}x ${objectName} in chest`;
      }

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `${actionText}. Tx: ${txHash}` 
      }));

      delete (globalThis as any).chestInteraction;

    } catch (error) {
      delete (globalThis as any).chestInteraction;
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Transfer failed: ${String(error)}` 
      }));
    }
  }
}

async function getPlayerInventory(entityId: `0x${string}`) {
  const query = `SELECT "slot", "entityId", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner" = '${entityId}'`;
  
  console.log('Debug: getPlayerInventory query:', query);
  console.log('Debug: entityId:', entityId);
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  console.log('Debug: getPlayerInventory full result:', JSON.stringify(result, null, 2));
  console.log('Debug: result?.result?.[0]:', result?.result?.[0]);
  
  // Use the exact same pattern as inventory.ts
  const rows = result?.result?.[0];
  console.log('Debug: rows:', rows);
  
  return rows || [];
}
