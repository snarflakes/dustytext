import { Skill, registerSkill } from './types';

export const automineSkill: Skill = async (ctx) => {
  // 1. Parse DOM for latest .explore-output
  const pres = Array.from(document.querySelectorAll<HTMLPreElement>(".explore-output"));
  if (pres.length === 0) {
    await ctx.say?.("No recent explore output found. Run 'explore' first.");
    return "blocked";
  }

  const latestPre = pres[pres.length - 1];
  const blocks = latestPre.querySelectorAll<HTMLElement>(".clickable-block");
  
  let queuedCount = 0;
  blocks.forEach(el => {
    const raw = el.getAttribute("data-block");
    if (!raw) return;
    
    try {
      const block = JSON.parse(raw.replace(/&quot;/g, '"'));
      const name = block.name?.toLowerCase() || '';
      
      if (name.includes('switchgrass') || name.includes('fescue')) {
        // Simulate click to add to mine queue
        el.click();
        queuedCount++;
      }
    } catch { /* ignore */ }
  });

  if (queuedCount === 0) {
    await ctx.say?.("No grass blocks found in recent explore.");
    return "done";
  }

  // Execute the queue
  await ctx.exec("done");
  await ctx.say?.(`Auto-mined ${queuedCount} grass blocks.`);
  return "done";
};

registerSkill("mine", automineSkill, {
  requiredLevel: 3,
  description: "Auto-select and mine all grass blocks from recent explore output",
  args: [], // Add this empty array for consistent formatting
  examples: ["explore west", "skill mine"]
});

