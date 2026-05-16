import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const schema = z.object({
    key: z.string().describe('The key to store the data under.'),
    value: z.any().describe('The data to store. Serialize objects to string.')
});

console.log(JSON.stringify(zodToJsonSchema(schema), null, 2));
