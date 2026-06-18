/**
 * Axiomify Jobs and Saga Workflows Server Example.
 *
 * Demonstrates:
 * - Registering the `@axiomify/jobs` module in the DI container.
 * - Registering background job execution handlers.
 * - Enqueuing basic jobs with custom payloads and priority.
 * - Defining multi-step Saga coordination workflows with automated rollback compensation tasks.
 * - Simulating distributed concurrency queues.
 * - Automatic startup and graceful shutdown of background workers.
 */
import { Axiomify, z, type AppModule } from '@axiomify/core';
import { NativeAdapter } from '@axiomify/native';
import { jobsModule, SagaCoordinator } from '@axiomify/jobs';

const app = new Axiomify();

// 1. Register the Jobs module with memory storage
app.use(
  jobsModule({
    queue: 'payment-service',
    storage: 'memory',
    maxConcurrency: 3,
    pollIntervalMs: 500, // checks every 500ms
  })
);

// 2. Create a module to configure job executors and handlers
const billingModule: AppModule = {
  name: 'billing',
  dependencies: ['jobs'],
  register: (app, ctx) => {
    const jobs = ctx.resolve('jobs');

    // Define background task execution handlers
    jobs.register('send-invoice', async (payload: { email: string; amount: number }) => {
      console.log(`[Worker] Generating and sending invoice of $${payload.amount} to ${payload.email}...`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(`[Worker] Invoice sent successfully to ${payload.email}!`);
    });

    jobs.register('charge-credit-card', async (payload: { cardToken: string; amount: number }) => {
      console.log(`[Worker] Charging credit card (token: ${payload.cardToken}) for $${payload.amount}...`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      console.log(`[Worker] Credit card charged successfully!`);
    });

    // Compensation task if charging card failed but we need to refund
    jobs.register('refund-credit-card', async (payload: { cardToken: string; amount: number }) => {
      console.log(`[Compensation] Reversing/Refunding charge of $${payload.amount} on card ${payload.cardToken}...`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.log(`[Compensation] Refund transaction completed.`);
    });

    // Step compensation for ledger update
    jobs.register('reverse-ledger', async (payload: { ledgerId: string }) => {
      console.log(`[Compensation] Reversing ledger record ${payload.ledgerId}...`);
    });

    // 3. Define HTTP routes to trigger background workloads
    app.route({
      method: 'POST',
      path: '/invoice',
      schema: {
        body: z.object({
          email: z.string().email(),
          amount: z.number().positive(),
        }),
      },
      handler: async (req, res) => {
        // Enqueue background job to run asynchronously
        const jobId = await jobs.enqueue('send-invoice', {
          email: req.body.email,
          amount: req.body.amount,
        });

        res.status(202).send({
          status: 'accepted',
          message: 'Invoice job queued for background execution',
          jobId,
        });
      },
    });

    // 4. Define HTTP route demonstrating a Saga distributed transaction workflow
    app.route({
      method: 'POST',
      path: '/checkout',
      schema: {
        body: z.object({
          email: z.string().email(),
          amount: z.number().positive(),
          cardToken: z.string(),
          simulateFailure: z.boolean().default(false),
        }),
      },
      handler: async (req, res) => {
        // Instantiate a Saga workflow coordinator
        const saga = new SagaCoordinator(jobs);
        const { cardToken, amount, simulateFailure, email } = req.body;

        // Step 1: Charge Card
        saga.addStep(
          'charge-card',
          async () => {
            console.log('[Saga] Step 1: Enqueuing card charge');
            // Execute JIT action
            return { ok: true, amountCharged: amount };
          },
          async () => {
            // Register rollback compensatory logic in case later steps fail
            await jobs.enqueue('refund-credit-card', { cardToken, amount });
          }
        );

        // Step 2: Write Ledger entry
        const ledgerId = `ldgr_${Math.random().toString(36).substring(7)}`;
        saga.addStep(
          'update-ledger',
          async () => {
            console.log(`[Saga] Step 2: Updating accounting ledger (${ledgerId})`);
            if (simulateFailure) {
              throw new Error('Database integrity constraints failed');
            }
            return { ledgerId };
          },
          async () => {
            // Register compensation to reverse ledger
            await jobs.enqueue('reverse-ledger', { ledgerId });
          }
        );

        // Run the workflow
        const outcome = await saga.execute({ email });

        if (outcome.success) {
          res.send({
            status: 'success',
            message: 'Checkout transaction completed successfully',
            outcome,
          });
        } else {
          res.status(500).send({
            status: 'failed',
            message: 'Checkout transaction failed. Compensation rollbacks enqueued.',
            error: outcome.error,
          });
        }
      },
    });
  },
};

app.use(billingModule);

// 5. Run the background worker loops automatically on adapter listen
const adapter = new NativeAdapter(app, { port: 3000 });

if (require.main === module) {
  adapter.listen((port) => {
    console.log(`🚀 Billing Service + Jobs Queue running on port ${port}`);
    console.log(`💼 Access the Axiomify Studio console to view active jobs & metrics`);
    
    // Auto-start queue worker loops
    const scheduler = app.resolve('jobs');
    scheduler.start();
  });
}
