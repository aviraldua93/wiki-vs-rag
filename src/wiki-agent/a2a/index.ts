/**
 * Barrel export for A2A module.
 */

export {
  createAgentCard,
  parseJsonRpcRequest,
  createSuccessResponse,
  createErrorResponse,
  extractQueryFromA2ARequest,
  formatAnswerAsA2AResult,
  JSON_RPC_ERRORS,
} from './protocol.ts';

export type {
  AgentCard,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MessagePart,
  A2AMessage,
} from './protocol.ts';

export { startServer, TaskStore } from './server.ts';
export type { A2AServerOptions, A2AServerHandle, TaskRecord } from './server.ts';
