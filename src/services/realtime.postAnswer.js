import {
  TOOL_END_ROUND,
  buildModeratorBaseInstructions,
  buildPostAnswerInstructions,
} from "./realtime.prompts.js";

export async function runPostAnswerFlow({
  session,
  systemPrompt,
  gameContext,
}) {
  await session.setMonologueMode({
    tools: [TOOL_END_ROUND],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildPostAnswerInstructions(systemPrompt, gameContext),
    tools: [TOOL_END_ROUND],
    outputModalities: ["audio"],
    metadata: { stage: "post_answer_evaluation" },
    maxOutputTokens: 700,
  });

  const tool = await session.waitForToolCall("end_round", 45000);
  await session.waitForAudioStopped(
    tool.responseId || created.responseId,
    30000
  );
  return tool.args;
}
