/**
 * claudeService.js — AI coaching via Groq API
 *
 * Despite the filename, this module uses the Groq SDK (model: groq/compound-mini),
 * not Anthropic Claude. The name is a legacy artifact.
 *
 * Two functions are exported:
 *
 *   generateExplanations(mistakes, playerColor)
 *     Sends all player mistakes to Groq in a single batch request.
 *     Returns the same mistakes array with an `explanation` string added to each.
 *     Gracefully returns null explanations if GROQ_API_KEY is not set.
 *
 *   generateCoachingSummary(profile)
 *     Generates a 3–4 sentence personalised coaching tip based on the user's
 *     WeaknessProfile (top weaknesses, accuracy, win/loss record).
 *     Used on the Analysis page and Dashboard.
 *
 * Required env: GROQ_API_KEY
 *
 * @module services/claudeService
 */

const Groq = require('groq-sdk');

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'groq/compound-mini';

exports.generateExplanations = async (mistakes, playerColor) => {
  if (!mistakes || mistakes.length === 0) return [];
  if (!process.env.GROQ_API_KEY) {
    console.warn('⚠️  GROQ_API_KEY not set — skipping explanations');
    return mistakes.map((m) => ({ ...m, explanation: null }));
  }

  const mistakeList = mistakes.map((m, i) =>
    `Move ${i + 1} (Move ${m.moveNumber}, ${m.type}):
- Player played: ${m.played}
- Best move was: ${m.best}
- Win chance lost: ${m.winDropPct}%
- Category: ${m.category}`
  ).join('\n\n');

  const prompt = `You are a chess coach analyzing moves made by a ${playerColor} player.

For each move below, write a 2-3 sentence explanation in plain English.
- For a "blunder": explain clearly what went wrong and why the best move was much better.
- For a "mistake": explain the error and what the better move achieves.
- For an "inaccuracy": gently note what was slightly suboptimal and what the better move does.

Be specific, concise, and encouraging. Avoid excessive jargon.

${mistakeList}

Respond with a JSON array where each object has:
- "moveNumber": (number)
- "explanation": (string, 2-3 sentences)

Only return valid JSON, no other text.`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.choices[0].message.content.trim();
    const json = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const explanations = JSON.parse(json);

    return mistakes.map((m) => {
      const found = explanations.find((e) => e.moveNumber === m.moveNumber);
      return { ...m, explanation: found?.explanation ?? null };
    });
  } catch (err) {
    console.error('Groq API error:', err.message);
    return mistakes.map((m) => ({ ...m, explanation: null }));
  }
};

exports.generateGameNarrative = async (game) => {
  if (!process.env.GROQ_API_KEY) return null;

  const topMistakes = (game.mistakes || [])
    .filter(m => m.color === game.playerColor && m.type === 'blunder')
    .slice(0, 3);

  const mistakeSummary = topMistakes.length > 0
    ? topMistakes.map(m =>
        `Move ${m.moveNumber}: played ${m.played}, best was ${m.best} (-${m.winDropPct?.toFixed(0) ?? '?'}% win chance)`
      ).join('; ')
    : 'No major blunders';

  const prompt = `You are a chess coach writing a brief game report.

Game: ${game.playerColor} vs ${game.opponent} (${game.result})
Opening: ${game.opening ?? 'Unknown'}
Accuracy: ${game.accuracy ?? '?'}%
Blunders: ${topMistakes.length}
Key mistakes: ${mistakeSummary}

Write a 3-paragraph game report:
1. Opening phase: how the game started, was the opening handled well?
2. Critical moment: describe the most impactful mistake and its consequences.
3. Lesson: one specific, actionable improvement to take from this game.

Be specific, concise (2-3 sentences per paragraph), and encouraging. Return plain text only, no markdown.`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0].message.content.trim();
  } catch {
    return null;
  }
};

exports.generateCoachingSummary = async (profile) => {
  if (!process.env.GROQ_API_KEY) return null;

  const { topWeaknesses, averageAccuracy, gamesAnalyzed, results } = profile;

  const prompt = `You are a chess coach. Based on this player's stats, write a short (3-4 sentence) personalized coaching message:

- Games analyzed: ${gamesAnalyzed}
- Average accuracy: ${averageAccuracy ?? 'unknown'}%
- Record: ${results.wins}W / ${results.losses}L / ${results.draws}D
- Top weaknesses: ${topWeaknesses.join(', ')}

Be encouraging, specific about their biggest weakness, and give one actionable tip. Keep it conversational.`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0].message.content.trim();
  } catch {
    return null;
  }
};
