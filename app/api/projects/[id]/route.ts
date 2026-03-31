import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { deleteProject, deleteProjectFromSql, getOutstockBenefitDebug, getOutstockBenefitSummary, getProjectById, getProjectByIdFromSql, getProjectTasks, hasProjectSqlConfig, persistProjectToSql, updateProject } from "@/lib/server/store";
import { BomChangeType, BomTraceItem, Project, User } from "@/types";

const canViewProject = (user: User, project: Project) => {
  if (user.role === "admin") return true;
  return project.departmentId === user.departmentId;
};

const canDeleteProject = (user: User, project: Project) => {
  if (user.role === "admin") return true;
  return project.departmentId === user.departmentId;
};

const canEditProject = (user: User, project: Project) => {
  if (user.role === "admin") return true;
  if (user.role === "manager") {
    return project.type === "company" || project.departmentId === user.departmentId;
  }
  const role = project.memberRoles?.[user.id];
  if (role) return role !== "viewer";
  return project.memberIds.includes(user.id);
};

const sanitizeTraceItem = (item: unknown): BomTraceItem => {
  const record = (item || {}) as Record<string, unknown>;
  return {
    bomNumber: typeof record.bomNumber === "string" ? record.bomNumber : "",
    bomCode: typeof record.bomCode === "string" ? record.bomCode : "",
    bomName: typeof record.bomName === "string" ? record.bomName : "",
    auxQty: Number(record.auxQty) || 0,
    audDate: typeof record.audDate === "string" ? record.audDate : "",
  };
};

const mergeProjectBom = (primary: Project, fallback: Project) => ({
  ...primary,
  formTemplateId: primary.formTemplateId ?? fallback.formTemplateId,
  formTemplateName: primary.formTemplateName ?? fallback.formTemplateName,
  bomChangeType: primary.bomChangeType ?? fallback.bomChangeType,
  bomTargetId: primary.bomTargetId ?? fallback.bomTargetId,
  bomTargetName: primary.bomTargetName ?? fallback.bomTargetName,
  bomDiffItems: (primary.bomDiffItems?.length ?? 0) > 0 ? primary.bomDiffItems : fallback.bomDiffItems,
  bomMaterialAdjustments:
    (primary.bomMaterialAdjustments?.length ?? 0) > 0
      ? primary.bomMaterialAdjustments
      : fallback.bomMaterialAdjustments,
  bomDiffTraceItems:
    (primary.bomDiffTraceItems?.length ?? 0) > 0 ? primary.bomDiffTraceItems : fallback.bomDiffTraceItems,
  bomRawReplaceTraceItems:
    (primary.bomRawReplaceTraceItems?.length ?? 0) > 0
      ? primary.bomRawReplaceTraceItems
      : fallback.bomRawReplaceTraceItems,
  bomDiffBaseOrder:
    (primary.bomDiffBaseOrder?.length ?? 0) > 0 ? primary.bomDiffBaseOrder : fallback.bomDiffBaseOrder,
  bomDiffTargetOrder:
    (primary.bomDiffTargetOrder?.length ?? 0) > 0 ? primary.bomDiffTargetOrder : fallback.bomDiffTargetOrder,
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "项目ID不能为空" }, { status: 400 });
  }
  const sqlEnabled = hasProjectSqlConfig();
  const [sqlProject, localProject] = await Promise.all([
    sqlEnabled ? getProjectByIdFromSql(user, id) : Promise.resolve(null),
    Promise.resolve(getProjectById(id)),
  ]);
  const mergedProject = sqlProject && localProject ? mergeProjectBom(sqlProject, localProject) : null;
  const project = mergedProject ?? sqlProject ?? localProject;
  if (!project) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }
  if (!canViewProject(user, project)) {
    return NextResponse.json({ message: "无权限查看项目" }, { status: 403 });
  }
  const responseProject = project;
  const url = new URL(request.url);
  const summary = url.searchParams.get("summary");
  const wantsSummary = summary === "1" || summary === "true";
  if (wantsSummary) {
    return NextResponse.json({ project: responseProject });
  }
  const tasks = getProjectTasks(project.id);
  const debug = url.searchParams.get("debug");
  const wantsDebug = debug === "1" || debug === "true";
  if (wantsDebug) {
    const benefitDebug = await getOutstockBenefitDebug(project);
    return NextResponse.json({ project: responseProject, tasks, benefitDebug });
  }
  const benefitSummary = await getOutstockBenefitSummary(project);
  return NextResponse.json({ project: responseProject, tasks, benefitSummary });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "项目ID不能为空" }, { status: 400 });
  }
  const project = (await getProjectByIdFromSql(user, id)) ?? getProjectById(id);
  if (!project) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }
  if (!canDeleteProject(user, project)) {
    return NextResponse.json({ message: "无权限删除项目" }, { status: 403 });
  }
  deleteProject(project.id);
  await deleteProjectFromSql(project.id);
  return NextResponse.json({ success: true });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "项目ID不能为空" }, { status: 400 });
  }
  const project = (await getProjectByIdFromSql(user, id)) ?? getProjectById(id);
  if (!project) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }
  if (!canEditProject(user, project)) {
    return NextResponse.json({ message: "无权限保存项目" }, { status: 403 });
  }

  const body = (await request.json()) as Partial<Project> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "参数不合法" }, { status: 400 });
  }

  const typeValues: BomChangeType[] = ["replace", "materialAdjust", "rawMaterialReplace"];

  const patch: Partial<
    Pick<
      Project,
      | "name"
      | "initiator"
      | "problem"
      | "goal"
      | "actions"
      | "resources"
      | "cycle"
      | "benefit"
      | "approval"
      | "formTemplateId"
      | "formTemplateName"
      | "bomChangeType"
      | "bomTargetId"
      | "bomTargetName"
      | "bomDiffItems"
      | "bomMaterialAdjustments"
      | "bomDiffTraceItems"
      | "bomRawReplaceTraceItems"
      | "bomDiffBaseOrder"
      | "bomDiffTargetOrder"
    >
  > = {};

  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.initiator === "string") patch.initiator = body.initiator;
  if (typeof body.problem === "string") patch.problem = body.problem;
  if (typeof body.goal === "string") patch.goal = body.goal;
  if (typeof body.actions === "string") patch.actions = body.actions;
  if (typeof body.resources === "string") patch.resources = body.resources;
  if (typeof body.cycle === "string") patch.cycle = body.cycle;
  if (typeof body.benefit === "string") patch.benefit = body.benefit;
  if (typeof body.approval === "string") patch.approval = body.approval;
  if (typeof body.formTemplateId === "string") patch.formTemplateId = body.formTemplateId;
  if (typeof body.formTemplateName === "string") patch.formTemplateName = body.formTemplateName;
  if (typeof body.bomTargetId === "string") patch.bomTargetId = body.bomTargetId;
  if (typeof body.bomTargetName === "string") patch.bomTargetName = body.bomTargetName;
  if (typeof body.bomChangeType === "string" && typeValues.includes(body.bomChangeType)) {
    patch.bomChangeType = body.bomChangeType;
  }
  if (Array.isArray(body.bomDiffItems)) {
    patch.bomDiffItems = body.bomDiffItems.map((item) => ({
      materialCode: typeof item?.materialCode === "string" ? item.materialCode : "",
      materialName: typeof item?.materialName === "string" ? item.materialName : "",
      baseQty: Number(item?.baseQty) || 0,
      targetQty: Number(item?.targetQty) || 0,
      delta: Number(item?.delta) || 0,
      itemId: typeof item?.itemId === "string" ? item.itemId : undefined,
    }));
  }
  if (Array.isArray(body.bomMaterialAdjustments)) {
    patch.bomMaterialAdjustments = body.bomMaterialAdjustments.map((item) => ({
      materialCode: typeof item?.materialCode === "string" ? item.materialCode : "",
      materialName: typeof item?.materialName === "string" ? item.materialName : "",
      oldPrice: Number(item?.oldPrice) || 0,
      newPrice: Number(item?.newPrice) || 0,
      delta: Number(item?.delta) || 0,
      replaceFromCode: typeof item?.replaceFromCode === "string" ? item.replaceFromCode : "",
      replaceFromName: typeof item?.replaceFromName === "string" ? item.replaceFromName : "",
      replaceToCode: typeof item?.replaceToCode === "string" ? item.replaceToCode : "",
      replaceToName: typeof item?.replaceToName === "string" ? item.replaceToName : "",
    }));
  }
  if (Array.isArray(body.bomDiffTraceItems)) {
    patch.bomDiffTraceItems = body.bomDiffTraceItems.map((group) =>
      Array.isArray(group) ? group.map((item) => sanitizeTraceItem(item)) : []
    );
  }
  if (Array.isArray(body.bomRawReplaceTraceItems)) {
    patch.bomRawReplaceTraceItems = body.bomRawReplaceTraceItems.map((group) =>
      Array.isArray(group) ? group.map((item) => sanitizeTraceItem(item)) : []
    );
  }
  if (Array.isArray(body.bomDiffBaseOrder)) {
    patch.bomDiffBaseOrder = body.bomDiffBaseOrder.filter((item) => typeof item === "string");
  }
  if (Array.isArray(body.bomDiffTargetOrder)) {
    patch.bomDiffTargetOrder = body.bomDiffTargetOrder.filter((item) => typeof item === "string");
  }

  const updated = updateProject(project.id, patch);
  const nextProject = updated ?? {
    ...project,
    name: patch.name ?? project.name,
    initiator: patch.initiator ?? project.initiator,
    problem: patch.problem ?? project.problem,
    goal: patch.goal ?? project.goal,
    actions: patch.actions ?? project.actions,
    resources: patch.resources ?? project.resources,
    cycle: patch.cycle ?? project.cycle,
    benefit: patch.benefit ?? project.benefit,
    approval: patch.approval ?? project.approval,
    formTemplateId: patch.formTemplateId ?? project.formTemplateId,
    formTemplateName: patch.formTemplateName ?? project.formTemplateName,
    bomChangeType: patch.bomChangeType ?? project.bomChangeType,
    bomTargetId: patch.bomTargetId ?? project.bomTargetId,
    bomTargetName: patch.bomTargetName ?? project.bomTargetName,
    bomDiffItems: patch.bomDiffItems ?? project.bomDiffItems,
    bomMaterialAdjustments: patch.bomMaterialAdjustments ?? project.bomMaterialAdjustments,
    bomDiffTraceItems: patch.bomDiffTraceItems ?? project.bomDiffTraceItems,
    bomRawReplaceTraceItems: patch.bomRawReplaceTraceItems ?? project.bomRawReplaceTraceItems,
    bomDiffBaseOrder: patch.bomDiffBaseOrder ?? project.bomDiffBaseOrder,
    bomDiffTargetOrder: patch.bomDiffTargetOrder ?? project.bomDiffTargetOrder,
  };
  await persistProjectToSql(nextProject);
  return NextResponse.json(nextProject);
}
