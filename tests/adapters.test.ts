import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { z } from "zod";
import { route } from "../src/core/route";
import { registry } from "../src/core/registry";
import { createExpressApp } from "../src/adapters/express";
import { createFastifyApp } from "../src/adapters/fastify";

describe("Axiomify Adapters: Integration Tests", () => {
  // 1. Set up our test contract in the registry before tests run
  beforeAll(() => {
    registry.clear();
    registry.register({
      filePath: "virtual/users.ts",
      tag: "users",
      config: route({
        method: "POST",
        path: "/users",
        request: {
          body: z.object({ email: z.string().email() }),
        },
        response: z.object({ success: z.boolean(), email: z.string() }),
        handler: async ({ body }) => {
          return { success: true, email: body.email };
        },
      }),
    });
  });

  describe("Express Adapter", () => {
    it("should validate inputs and return a successful response", async () => {
      const app = createExpressApp();

      // Supertest wraps the Express app and simulates the request in-memory
      const response = await request(app)
        .post("/users")
        .send({ email: "test@axiomify.dev" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        email: "test@axiomify.dev",
      });
    });

    it("should block invalid requests and return a 400 status", async () => {
      const app = createExpressApp();

      const response = await request(app)
        .post("/users")
        .send({ email: "not-an-email" }); // Breaks the Zod contract

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Validation Error");
    });
  });

  describe("Fastify Adapter", () => {
    it("should validate inputs and return a successful response", async () => {
      const app = await createFastifyApp();

      // Fastify's native .inject() method is incredibly fast
      const response = await app.inject({
        method: "POST",
        url: "/users",
        payload: { email: "test@axiomify.dev" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({
        success: true,
        email: "test@axiomify.dev",
      });
    });

    it("should block invalid requests and return a 400 status", async () => {
      const app = await createFastifyApp();

      const response = await app.inject({
        method: "POST",
        url: "/users",
        payload: { email: "not-an-email" },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error).toBe("Validation Error");
    });
  });
});
