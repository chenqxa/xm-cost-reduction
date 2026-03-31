import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { createProject, getCompletedTaskCountByProject, getFormTemplateById, getTaskCountByProject, getVisibleProjectSummariesFromSql, getVisibleProjectsFromSql, persistProjectToSql } from "@/lib/server/store";
import { Project } from "@/types";

const sanitizeSqlMessage = (message: string) =>
  message
    .replace(/password\s*=\s*[^;]+/gi, "password=***")
    .replace(/user\s*id\s*=\s*[^;]+/gi, "user id=***")
    .replace(/uid\s*=\s*[^;]+/gi, "uid=***")
    .replace(/pwd\s*=\s*[^;]+/gi, "pwd=***");

const formatSqlErrorMessage = (error: unknown) => {
  const raw = typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message || "") : "";
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const cleaned = raw ? sanitizeSqlMessage(raw) : "";
  if (code.includes("ETIMEOUT")) return "SQL Server 连接超时，请检查网络或服务器是否可达";
  if (code.includes("ELOGIN")) return "SQL Server 登录失败，请检查账号或密码";
  if (code.includes("ESOCKET")) return "SQL Server 连接中断，请检查网络稳定性";
  if (code.includes("EHOST")) return "SQL Server 地址不可达，请检查服务器地址或端口";
  if (cleaned) return `SQL Server 查询失败：${cleaned}`;
  return "SQL Server 查询失败";
};

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const summary = url.searchParams.get("summary");
    const wantsSummary = summary === "1" || summary === "true";
    const sqlProjects = wantsSummary
      ? await getVisibleProjectSummariesFromSql(user)
      : await getVisibleProjectsFromSql(user);
    const projects = sqlProjects ?? [];
    const payload = projects.map((project) => ({
      ...project,
      taskCount: getTaskCountByProject(project.id),
      completedTaskCount: getCompletedTaskCountByProject(project.id),
    }));
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ message: formatSqlErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (user.role === "employee") {
    return NextResponse.json({ message: "无权限创建项目" }, { status: 403 });
  }
  const body = (await request.json()) as Pick<
    Project,
    | "name"
    | "description"
    | "formTemplateId"
    | "formTemplateName"
    | "bomChangeType"
    | "bomTargetId"
    | "bomTargetName"
    | "bomDiffItems"
    | "bomMaterialAdjustments"
    | "bomDiffBaseOrder"
    | "bomDiffTargetOrder"
    | "initiator"
    | "problem"
    | "goal"
    | "actions"
    | "resources"
    | "cycle"
    | "benefit"
    | "approval"
    | "type"
    | "departmentId"
  >;
  if (!body.name) {
    return NextResponse.json({ message: "项目名称不能为空" }, { status: 400 });
  }
  if (body.formTemplateId != null) {
    if (typeof body.formTemplateId !== "string") {
      return NextResponse.json({ message: "formTemplateId格式不正确" }, { status: 400 });
    }
    if (body.formTemplateId.trim() === "") {
      delete body.formTemplateId;
    } else {
      const template = getFormTemplateById(body.formTemplateId);
      if (!template) {
        return NextResponse.json({ message: "表单不存在" }, { status: 400 });
      }
      if (template.companyId !== user.companyId) {
        return NextResponse.json({ message: "无权限使用该表单" }, { status: 403 });
      }
    }
  }
  if (body.bomChangeType != null) {
    if (
      body.bomChangeType !== "replace" &&
      body.bomChangeType !== "materialAdjust" &&
      body.bomChangeType !== "rawMaterialReplace"
    ) {
      return NextResponse.json({ message: "BOM变更方式不合法" }, { status: 400 });
    }
  }
  body.type = "department";
  if (user.role === "manager") {
    if (!user.departmentId) {
      return NextResponse.json({ message: "账号未绑定部门" }, { status: 400 });
    }
    body.departmentId = user.departmentId;
  }
  if (user.role === "admin") {
    if (!body.departmentId) {
      return NextResponse.json({ message: "请选择所属部门" }, { status: 400 });
    }
  }
  const project = createProject(user, body);
  await persistProjectToSql(project);
  return NextResponse.json(project);
}
