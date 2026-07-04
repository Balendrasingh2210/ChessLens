const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate plain-English explanations for a list of chess mistakes.
 * Batches all mistakes into a single Claude call to minimize API usage.
 */
exports.generateExplanations = async (mistakes, playerColor) => {
  if (!mistakes || mistakes.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY not set — skipping explanations');
    return mistakes.map((m) => ({ ...m, explanation: null }));
  }

  const mistakeList = mistakes.map((m, i) =>
    `Mistake ${i + 1} (Move ${m.moveNumber}, ${m.type}):
- Position FEN: ${m.playedFen}
- Player played: ${m.played}
- Best move was: ${m.best}
- Centipawn loss: ${m.delta}
- Category: ${m.category}`
  ).join('\n\n');

  const prompt = `You are a chess coach analyzing mistakes made by a ${playerColor} player.

For each mistake below, write a 2-3 sentence explanation in plain English that:
1. States what was wrong with the move they played
2. Explains why the best move was better
3. Gives a practical tip to avoid this type of mistake in future

Be specific, concise, and encouraging. Avoid excessive jargon.

${mistakeList}

Respond with a JSON array where each object has:
- "moveNumber": (number)
- "explanation": (string, 2-3 sentences)

Only return valid JSON, no other text.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    // Strip markdown code blocks if present
    const json = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const explanations = JSON.parse(json);

    return mistakes.map((m) => {
      const found = explanations.find((e) => e.moveNumber === m.moveNumber);
      return { ...m, explanation: found?.explanation ?? null };
    });
  } catch (err) {
    console.error('Claude API error:', err.message);
    return mistakes.map((m) => ({ ...m, explanation: null }));
  }
};

/**
 * Generate a personalized coaching summary from a user's weakness profile.
 */
exports.generateCoachingSummary = async (profile) => {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const { topWeaknesses, averageAccuracy, gamesAnalyzed, results } = profile;

  const prompt = `You are a chess coach. Based on this player's stats, write a short (3-4 sentence) personalized coaching message:

- Games analyzed: ${gamesAnalyzed}
- Average accuracy: ${averageAccuracy ?? 'unknown'}%
- Record: ${results.wins}W / ${results.losses}L / ${results.draws}D
- Top weaknesses: ${topWeaknesses.join(', ')}

Be encouraging, specific about their biggest weakness, and give one actionable tip. Keep it conversational.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0].text.trim();
  } catch {
    return null;
  }
};
