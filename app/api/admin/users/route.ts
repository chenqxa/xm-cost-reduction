import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { createUser, getAllUsers, updateUser } from "@/lib/server/store";
import { User, UserRole } from "@/types";

const sanitizeUser = (user: User): Omit<User, "password"> => {
  const { password: _password, ...rest } = user;
  void _password;
  return rest;
};

const roleValues: UserRole[] = ["admin", "manager", "employee"];

export async function GET(request: NextRequest) {
  const me = getUserFromRequest(request);
  if (!me) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (me.role !== "admin") {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }
  return NextResponse.json(getAllUsers().map(sanitizeUser));
}

export async function POST(request: NextRequest) {
  const me = getUserFromRequest(request);
  if (!me) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (me.role !== "admin") {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  const body = (await request.json()) as {
    name?: string;
    username?: string;
    role?: UserRole;
    departmentId?: string | null;
    avatar?: string | null;
    password?: string;
  };

  const name = body.name?.trim() || "";
  const username = body.username?.trim() || "";
  const role = body.role;

  if (!name) {
    return NextResponse.json({ message: "姓名不能为空" }, { status: 400 });
  }
  if (!username) {
    return NextResponse.json({ message: "用户名不能为空" }, { status: 400 });
  }
  if (!role || !roleValues.includes(role)) {
    return NextResponse.json({ message: "角色不合法" }, { status: 400 });
  }

  const password = body.password?.trim() || "admin";
  if (!password) {
    return NextResponse.json({ message: "密码不能为空" }, { status: 400 });
  }

  const departmentId =
    role === "admin" ? undefined : body.departmentId?.trim() || undefined;

  const avatar = body.avatar?.trim() || undefined;

  const created = createUser({
    name,
    username,
    role,
    departmentId,
    companyId: me.companyId,
    avatar,
    password,
  });

  if (!created) {
    return NextResponse.json({ message: "用户名已存在或不合法" }, { status: 409 });
  }

  return NextResponse.json(sanitizeUser(created));
}

export async function PATCH(request: NextRequest) {
  const me = getUserFromRequest(request);
  if (!me) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }
  if (me.role !== "admin") {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  const body = (await request.json()) as {
    userId?: string;
    role?: UserRole;
    departmentId?: string | null;
  };

  if (!body.userId) {
    return NextResponse.json({ message: "用户ID不能为空" }, { status: 400 });
  }

  const role = body.role;
  if (role && !roleValues.includes(role)) {
    return NextResponse.json({ message: "角色不合法" }, { status: 400 });
  }

  const patch: Partial<Pick<User, "role" | "departmentId">> = {};
  if (role) {
    patch.role = role;
    patch.departmentId = role === "admin" ? undefined : body.departmentId ?? undefined;
  } else if (body.departmentId !== undefined) {
    patch.departmentId = body.departmentId ?? undefined;
  }

  const updated = updateUser(body.userId, patch);
  if (!updated) {
    return NextResponse.json({ message: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json(sanitizeUser(updated));
}
