
export { MyWorkflow } from "./workflow";
export { WorkflowStatusDO } from "./durable-object";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The backup service is not publicly accessible.
    return new Response("Not found", { status: 404 });
  },

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const date = new Date(event.scheduledTime)
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
