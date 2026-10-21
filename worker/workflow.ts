import {
  WorkflowEntrypoint,
  WorkflowStep
} from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";

const ACCOUNT_ID = "5189a2f7ec21bde11d2e7b71de93345f";
const DATABASE_ID = "2ff8a48c-e327-4d19-bf1d-ce184e931b09";

type BackupParams = {
  date: string;
};

type ExportResult = {
  signed_url?: string;
  current_bookmark?: string;
};

async function exportRequest(
  token: string,
  payload: Record<string, string>
): Promise<ExportResult> {
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}` +
    `/d1/database/${DATABASE_ID}/export`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      output_format: "polling",
      ...payload
    })
  });

  const data = await response.json() as {
    success: boolean;
    result?: ExportResult;
    errors?: unknown[];
  };

  if (!response.ok || !data.success) {
    throw new Error(
      `D1 export failed (${response.status}): ` +
      JSON.stringify(data.errors || data)
    );
  }

  return data.result || {};
}

export class MyWorkflow extends WorkflowEntrypoint<
  Env,
  BackupParams
> {
  async run(
    event: WorkflowEvent<BackupParams>,
    step: WorkflowStep
  ) {
    const date = event.payload.date;

    let result = await step.do(
      "start D1 export",
      async () => {
        if (!this.env.D1_REST_API_TOKEN) {
          throw new Error("Missing D1_REST_API_TOKEN");
        }

        return exportRequest(
          this.env.D1_REST_API_TOKEN,
          {}
        );
      }
    );

    for (let attempt = 1; attempt <= 60; attempt++) {
      if (result.signed_url) break;

      const bookmark = result.current_bookmark;

      if (!bookmark) {
        throw new Error(
          "D1 export returned no URL or polling bookmark"
        );
      }

      await step.sleep(
        `wait before poll ${attempt}`,
        "10 seconds"
      );

      result = await step.do(
        `poll D1 export ${attempt}`,
        async () => exportRequest(
          this.env.D1_REST_API_TOKEN,
          { current_bookmark: bookmark }
        )
      );
    }

    if (!result.signed_url) {
      throw new Error("D1 export timed out");
    }

    const downloadUrl = result.signed_url;

    const saved = await step.do(
      "save SQL backup to EU R2",
      {
        retries: {
          limit: 3,
          delay: "10 seconds",
          backoff: "exponential"
        }
      },
      async () => {
        const response = await fetch(downloadUrl);

        if (!response.ok) {
          throw new Error(
            `SQL download failed: ${response.status}`
          );
        }

        const contents = await response.arrayBuffer();

        if (contents.byteLength === 0) {
          throw new Error("SQL backup is empty");
        }

        const key =
          `daily/${date}/` +
          `boringteacher-vocabulary-${date}-` +
          `${event.instanceId}.sql`;

        await this.env.BACKUP_BUCKET.put(key, contents, {
          httpMetadata: {
            contentType: "application/sql"
          },
          customMetadata: {
            database: "boringteacher-vocabulary",
            backupDate: date
          }
        });

        const object = await this.env.BACKUP_BUCKET.head(key);

        if (!object || object.size !== contents.byteLength) {
          throw new Error("R2 backup verification failed");
        }

        return {
          key,
          bytes: contents.byteLength
        };
      }
    );

    console.log(
      `BACKUP SUCCESS: ${saved.key} (${saved.bytes} bytes)`
    );

    return {
      success: true,
      date,
      ...saved
    };
  }
}
