// TODO: select provider, verify template/consent policy and approve costs before implementation.
// No phone number collection or external delivery exists in this phase.
export interface DeadlineAlimtalk {
  queueDeadlineReminder(input: { userId: string; programId: string; deadline: string }): Promise<{ status: 'not_configured' }>;
}
export const deadlineAlimtalk: DeadlineAlimtalk = {
  async queueDeadlineReminder() { return { status: 'not_configured' }; },
};
