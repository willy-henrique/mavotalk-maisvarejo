import test from "node:test";
import assert from "node:assert/strict";
import {
  businessTools,
  getBusinessTool,
} from "../../lib/mcp/business-tool-registry";

test("registry MCP contém somente ferramentas gerenciais de leitura", () => {
  assert.equal(businessTools.length, 12);
  assert.equal(getBusinessTool("execute_sql"), null);
  assert.equal(
    getBusinessTool("get_sales_total")?.requiredPermission,
    "finance.read",
  );
  assert.equal(
    getBusinessTool("get_sales_count")?.requiredPermission,
    "sales.read",
  );
  for (const tool of businessTools) {
    assert.match(tool.name, /^get_|^compare_/);
    assert.ok(tool.description.length > 20);
    assert.ok(tool.requiredPermission.endsWith(".read"));
    assert.equal(
      tool.inputSchema.safeParse({
        period: "hoje",
        sql: "select * from users",
      }).success,
      false,
      `${tool.name} não deve aceitar SQL`,
    );
    assert.equal(
      tool.inputSchema.safeParse({
        period: "hoje",
        organization_id: "outro-tenant",
      }).success,
      false,
      `${tool.name} não deve aceitar organization_id`,
    );
  }
});
