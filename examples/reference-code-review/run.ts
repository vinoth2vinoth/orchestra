import { runCodeReviewReference } from './workflow.ts';

const result = await runCodeReviewReference();
console.log(JSON.stringify(result, null, 2));
