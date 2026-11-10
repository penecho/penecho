"use strict";

const MIN_CANVAS_AGENT_TURN_LIMIT = 50;
const DEFAULT_CANVAS_AGENT_TURN_LIMIT = 100;

function validCanvasAgentTurnLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= MIN_CANVAS_AGENT_TURN_LIMIT;
}

function configuredCanvasAgentTurnLimit(value) {
  return validCanvasAgentTurnLimit(value) ? Number(value) : DEFAULT_CANVAS_AGENT_TURN_LIMIT;
}

module.exports = {
  MIN_CANVAS_AGENT_TURN_LIMIT,
  DEFAULT_CANVAS_AGENT_TURN_LIMIT,
  validCanvasAgentTurnLimit,
  configuredCanvasAgentTurnLimit,
};
