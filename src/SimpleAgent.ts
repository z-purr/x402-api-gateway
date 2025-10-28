import OpenAI from 'openai';
import { EventQueue, RequestContext, TaskState } from './x402Types.js';

/**
 * SimpleAgent is an AI agent that processes user requests using OpenAI
 * Payment validation is handled by the server before invoking this agent
 */
export class SimpleAgent {
  private openai: OpenAI;
  private payToAddress: string;
  private network: string;

  constructor(apiKey: string, payToAddress: string, network: string = 'base-sepolia') {
    this.openai = new OpenAI({ apiKey });
    this.payToAddress = payToAddress;
    this.network = network;
  }

  async execute(context: RequestContext, eventQueue: EventQueue): Promise<void> {
    const task = context.currentTask;

    if (!task) {
      throw new Error('No task found in context');
    }
    console.log('✅ Payment verified, processing request...');

    // Extract user message from the context
    const userMessage = context.message?.parts
      ?.filter((part: any) => part.kind === 'text')
      .map((part: any) => part.text)
      .join(' ') || 'Hello';

    console.log(`📝 User request: ${userMessage}`);

    try {
      // Call OpenAI API to process the request
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant. Provide concise and accurate responses.',
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const response = completion.choices[0]?.message?.content || 'No response generated';

      console.log(`🤖 AI response: ${response}`);

      // Update task with the response
      task.status.state = TaskState.COMPLETED;
      task.status.message = {
        messageId: `msg-${Date.now()}`,
        role: 'agent',
        parts: [
          {
            kind: 'text',
            text: response,
          },
        ],
      };

      // Enqueue the completed task
      await eventQueue.enqueueEvent(task);

      console.log('✨ Request processed successfully');
    } catch (error) {
      console.error('❌ Error processing request:', error);

      // Update task with error
      task.status.state = TaskState.FAILED;
      task.status.message = {
        messageId: `msg-${Date.now()}`,
        role: 'agent',
        parts: [
          {
            kind: 'text',
            text: `Error processing request: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };

      await eventQueue.enqueueEvent(task);
      throw error;
    }
  }
}
