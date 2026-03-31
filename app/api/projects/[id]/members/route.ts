import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { getProjectById, updateProjectMemberRoles, updateProjectMembers } from "@/lib/server/store";
import { ProjectMemberRole } from "@/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ message: "项目ID不能为空" }, { status: 400 });
  }

  const project = getProjectById(id);
  if (!project) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }

  const body = (await request.json()) as {
    memberIds?: unknown;
    members?: unknown;
  };

  const roleValues: ProjectMemberRole[] = ["owner", "pm", "member", "viewer"];

  if (Array.isArray(body.members)) {
    const nextRoles: Record<string, ProjectMemberRole> = {};
    for (const item of body.members) {
      if (!item || typeof item !== "object") continue;
      const userId = (item as { userId?: unknown }).userId;
      const role = (item as { role?: unknown }).role;
      if (typeof userId !== "string") continue;
      if (typeof role !== "string") continue;
      if (!roleValues.includes(role as ProjectMemberRole)) continue;
      nextRoles[userId] = role as ProjectMemberRole;
    }
    nextRoles[project.creatorId] = "owner";
    const updated = updateProjectMemberRoles(project.id, nextRoles);
    if (!updated) {
      return NextResponse.json({ message: "项目不存在" }, { status: 404 });
    }
    return NextResponse.json(updated);
  }

  if (!Array.isArray(body.memberIds)) {
    return NextResponse.json(
      { message: "memberIds必须为数组，或使用members按角色分配" },
      { status: 400 }
    );
  }

  const nextMemberIds = body.memberIds.filter((item): item is string => typeof item === "string");
  if (!nextMemberIds.includes(project.creatorId)) nextMemberIds.push(project.creatorId);

  const updated = updateProjectMembers(project.id, nextMemberIds);
  if (!updated) {
    return NextResponse.json({ message: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
