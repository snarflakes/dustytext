import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';
import { findRecipesByDisplayName, formatObjectName, Recipe } from '../../recipes';
import { OBJECT_TYPES } from '../../objectTypes';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const INVENTORY_SLOT_TABLE = "InventorySlot";
const RECIPES_TABLE = "Recipes";

const craftAbi = parseAbi([
  'function craft(bytes32 caller, bytes32 recipeId, (uint16,uint16)[] inputs)',
  'function craftWithStation(bytes32 caller, bytes32 station, bytes32 recipeId, (uint16,uint16)[] inputs)',
]);

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

async function getPlayerInventory(entityId: `0x${string}`) {
  const query = `SELECT "slot", "entityId", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner" = '${entityId}'`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  return result?.result?.[0] || [];
}

async function getAvailableRecipes() {
  const query = `SELECT "recipeId", "stationTypeId", "craftingTime", "inputTypes", "inputAmounts", "outputTypes", "outputAmounts" FROM "${RECIPES_TABLE}"`;
  
  console.log('Fetching available recipes with query:', query);
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) {
    console.error('Recipe fetch failed with status:', response.status);
    throw new Error(`HTTP ${response.status}`);
  }
  
  const result = await response.json();
  console.log('Raw recipe response:', result);
  
  const recipes = result?.result?.[0] || [];
  console.log('Parsed recipes:', recipes);
  console.log('Recipe count:', Array.isArray(recipes) ? recipes.length : 'Not an array');
  
  return recipes;
}

function findMatchingRecipeId(availableRecipes: unknown[], targetRecipe: Recipe): string | null {
  const rows = availableRecipes.slice(1); // Skip header row
  
  for (const row of rows) {
    const [recipeId, stationTypeId, , inputTypes, inputAmounts, outputTypes, outputAmounts] = row as [string, string, string, string[], string[], string[], string[]];
    
    try {
      const inputTypeIds = inputTypes.map(id => parseInt(id));
      const outputTypeIds = outputTypes.map(id => parseInt(id));
      const inputAmountsNum = inputAmounts.map(amt => parseInt(amt));
      const outputAmountsNum = outputAmounts.map(amt => parseInt(amt));
      const stationId = parseInt(stationTypeId);
      
      // Compare inputs
      if (inputTypeIds.length !== targetRecipe.inputs.length) continue;
      const inputsMatch = inputTypeIds.every((typeId, i) => {
        const objectName = OBJECT_TYPES[typeId];
        return targetRecipe.inputs[i] && 
               targetRecipe.inputs[i][0] === objectName && 
               targetRecipe.inputs[i][1] === inputAmountsNum[i];
      });
      
      // Compare outputs  
      if (outputTypeIds.length !== targetRecipe.outputs.length) continue;
      const outputsMatch = outputTypeIds.every((typeId, i) => {
        const objectName = OBJECT_TYPES[typeId];
        return targetRecipe.outputs[i] && 
               targetRecipe.outputs[i][0] === objectName && 
               targetRecipe.outputs[i][1] === outputAmountsNum[i];
      });
      
      // Compare station
      const hasStation = stationId !== 0;
      const stationMatch = hasStation ? 
        (targetRecipe.station && OBJECT_TYPES[stationId] === targetRecipe.station) :
        !targetRecipe.station;
      
      if (inputsMatch && outputsMatch && stationMatch) {
        return recipeId;
      }
    } catch (e) {
      continue;
    }
  }
  
  return null;
}

export class CraftCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      const itemName = args.join(' ').trim();
      if (!itemName) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❓ Usage: craft <item name> (e.g., 'craft jungle planks')" 
        }));
        return;
      }

      // Find matching recipes
      const matchingRecipes = findRecipesByDisplayName(itemName);
      if (matchingRecipes.length === 0) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ No recipe found for "${itemName}"` 
        }));
        return;
      }

      const recipe = matchingRecipes[0]; // Use first matching recipe
      const entityId = encodePlayerEntityId(context.address);
      
      // Get player inventory
      const inventoryRows = await getPlayerInventory(entityId);
      if (!Array.isArray(inventoryRows) || inventoryRows.length < 2) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Inventory is empty or unavailable" 
        }));
        return;
      }

      // Parse inventory (skip header row)
      const inventory = inventoryRows.slice(1).map((row: unknown[]) => ({
        slot: parseInt(row[0] as string),
        entityId: row[1] as string,
        objectType: OBJECT_TYPES[parseInt(row[2] as string)] || `Unknown(${row[2]})`,
        amount: parseInt(row[3] as string)
      }));

      // Check if we have required inputs
      const requiredInputs = recipe.inputs;
      const inputSlots: Array<{ slot: number; amount: number }> = [];

      console.log('Required inputs:', requiredInputs);
      console.log('Player inventory:', inventory);

      for (const [requiredType, requiredAmount] of requiredInputs) {
        let remainingNeeded = requiredAmount;
        console.log(`Looking for ${requiredAmount} ${requiredType}`);
        
        // Handle "Any" types by checking for specific variants
        const typesToCheck = requiredType === "AnyPlank" 
          ? ["OakPlanks", "BirchPlanks", "JunglePlanks", "SakuraPlanks", "AcaciaPlanks", "SprucePlanks", "DarkOakPlanks", "MangrovePlanks"]
          : requiredType === "AnyLog"
          ? ["OakLog", "BirchLog", "JungleLog", "SakuraLog", "AcaciaLog", "SpruceLog", "DarkOakLog", "MangroveLog"]
          : requiredType === "AnyLeaf"
          ? ["OakLeaf", "BirchLeaf", "JungleLeaf", "SakuraLeaf", "AcaciaLeaf", "SpruceLeaf", "DarkOakLeaf", "MangroveLeaf"]
          : [requiredType];
        
        for (const item of inventory) {
          console.log(`Checking item: ${item.objectType} (${item.amount}) vs ${requiredType}`);
          if (typesToCheck.includes(item.objectType) && remainingNeeded > 0) {
            const useAmount = Math.min(item.amount, remainingNeeded);
            inputSlots.push({ slot: item.slot, amount: useAmount });
            remainingNeeded -= useAmount;
            console.log(`Found match! Using ${useAmount}, remaining needed: ${remainingNeeded}`);
          }
        }

        if (remainingNeeded > 0) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ Missing ${remainingNeeded} ${requiredType} for crafting` 
          }));
          return;
        }
      }

      // Get available recipes from the game state
      const availableRecipes = await getAvailableRecipes();
      const recipeId = findMatchingRecipeId(availableRecipes, recipe);
      
      if (!recipeId) {
        console.log('❌ No matching recipe found in game state');
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Recipe not found in game state for "${itemName}"` 
        }));
        return;
      }

      // Craft the item using the actual recipe ID from game state
      const data = encodeFunctionData({
        abi: craftAbi,
        functionName: 'craft',
        args: [entityId, recipeId as `0x${string}`, inputSlots.map(item => [item.slot, item.amount] as const)],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      const outputName = formatObjectName(recipe.outputs[0][0]);
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `✅ Crafted ${outputName}! Tx: ${txHash}` 
      }));

    } catch (error) {
      const errorMessage = String(error);
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Craft failed: ${errorMessage}` 
      }));
    }
  }
}

