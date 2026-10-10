// The model-chain tests script an exact sequence of provider responses in the
// older flat answer shape. A plan-repair re-prompt would consume extra
// responses and change those call counts, so repair is off by default under
// test. Tests of the repair loop itself set AI_PLAN_REPAIR_ROUNDS explicitly.
process.env.AI_PLAN_REPAIR_ROUNDS = process.env.AI_PLAN_REPAIR_ROUNDS ?? '0';
