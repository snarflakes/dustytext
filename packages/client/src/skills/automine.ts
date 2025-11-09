import { Skill, registerSkill } from './types';
import { addToQueue } from '../commandQueue';

export const automineSkill: Skill = async (ctx) => {
  // 1. Parse DOM for latest .explore-output
  const pres = Array.from(document.querySelectorAll<HTMLPreElement>(".explore-output"));
  if (pres.length === 0) {
    await ctx.say?.("No recent explore output found. Run 'explore' first.");
    return "blocked";
  }

  const latestPre = pres[pres.length - 1];
  const blocks = latestPre.querySelectorAll<HTMLElement>(".clickable-block");
  
  const grassBlocks: Array<{x: number, y: number, z: number}> = [];
  
  blocks.forEach(el => {
    const raw = el.getAttribute("data-block");
    if (!raw) return;
    
    try {
      const block = JSON.parse(raw.replace(/&quot;/g, '"'));
      const name = block.name?.toLowerCase() || '';
      
      if (name.includes('switchgrass') || name.includes('fescue')) {
        grassBlocks.push({
          x: Number(block.x),
          y: Number(block.y), 
          z: Number(block.z)
        });
      }
    } catch { /* ignore */ }
  });

  if (grassBlocks.length === 0) {
    await ctx.say?.("No grass blocks found in recent explore.");
    return "done";
  }

  // Use the queue system for batch mining
  addToQueue("mine", grassBlocks, "ai");
  await ctx.say?.(`Queued ${grassBlocks.length} grass blocks for mining.`);
  
  // Execute the queue (this will use batch mining if tool equipped)
  await ctx.exec("done");
  return "done";
};

registerSkill("mine", automineSkill, {
  requiredLevel: 3,
  description: "Auto-select and mine all grass blocks from recent explore output",
  args: [], // Add this empty array for consistent formatting
  examples: ["explore west", "skill mine"]
});


