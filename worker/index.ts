
export { MyWorkflow } from "./workflow";
export { WorkflowStatusDO } from "./durable-object";

export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const date = new Date(controller.scheduledTime)
      .toISOString()
      .slice(0, 10);

    console.log(`Starting scheduled backup: ${date}`);

    ctx.waitUntil(
      env.MY_WORKFLOW.create({
        id: `vocabulary-backup-${date}`,
        params: { date }
      }).then(instance => {
        console.log(`Backup workflow started: ${instance.id}`);
      })
    );
  }
} satisfies ExportedHandler<Env>;
