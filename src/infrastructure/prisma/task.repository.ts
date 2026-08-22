import { Task } from "@/domain/tasks/task";
import type { TaskRepository } from "@/domain/tasks/ports";
import type { PrismaLike } from "./client";

export class PrismaTaskRepository implements TaskRepository {
  constructor(private readonly db: PrismaLike) {}

  async findById(id: string): Promise<Task | null> {
    const row = await this.db.task.findUnique({ where: { id } });
    return row ? Task.rehydrate(row) : null;
  }

  async findBySlug(slug: string): Promise<Task | null> {
    const row = await this.db.task.findUnique({ where: { slug } });
    return row ? Task.rehydrate(row) : null;
  }
}
