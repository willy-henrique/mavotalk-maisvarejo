import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mavoConfig } from "@/lib/config/mavo-config";
import { getBusinessAccessUser } from "@/lib/business-access/business-access-repository";
import { permissionsForRole } from "@/lib/business-access/business-permissions";
import { businessTools, invokeBusinessTool } from "@/lib/mcp/business-tool-registry";
import { sanitizedError } from "@/lib/observability";

function mcpConfigurationError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "MCP_CONFIGURATION_ERROR",
    status: 400,
  });
}

async function authenticatedMcpContext() {
  if (!mavoConfig.mcpEnabled) {
    throw mcpConfigurationError(
      "MAVO_MCP_ENABLED deve estar habilitado explicitamente",
    );
  }
  const organizationId = process.env.MAVO_MCP_ORGANIZATION_ID?.trim();
  const accessUserId = process.env.MAVO_MCP_ACCESS_USER_ID?.trim();
  if (!organizationId || !accessUserId) {
    throw mcpConfigurationError(
      "MAVO_MCP_ORGANIZATION_ID e MAVO_MCP_ACCESS_USER_ID são obrigatórios",
    );
  }
  const user = await getBusinessAccessUser(organizationId, accessUserId);
  if (!user?.isActive) {
    throw Object.assign(new Error("Contexto MCP não autorizado"), {
      code: "MCP_UNAUTHORIZED",
      status: 403,
    });
  }
  return {
    organizationId,
    accessUserId,
    phoneNormalized: user.phoneNormalized,
    origin: "mcp" as const,
    permissions: permissionsForRole(user.role, user.permissions),
  };
}

export async function startBusinessMcpServer() {
  const context = await authenticatedMcpContext();
  const server = new McpServer(
    { name: "mavo-talk-business", version: process.env.APP_VERSION || "0.1.0" },
    {
      instructions:
        "Ferramentas gerenciais somente leitura. Nunca solicite SQL ou organization_id. O tenant e as permissões já estão no contexto autenticado.",
    },
  );

  for (const tool of businessTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await invokeBusinessTool(tool.name, context, input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          const safe = sanitizedError(error);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: safe }),
              },
            ],
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startBusinessMcpServer().catch((error) => {
    const safe = sanitizedError(error);
    console.error(JSON.stringify({ event: "mcp_start_failed", error: safe }));
    process.exit(1);
  });
}
