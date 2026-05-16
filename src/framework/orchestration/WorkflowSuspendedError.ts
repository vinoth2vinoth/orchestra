export class WorkflowSuspendedError extends Error {
    public approvalId: string;
    public state: any;
    
    constructor(approvalId: string, state: any, message: string = "Workflow Suspended") {
        super(message);
        this.approvalId = approvalId;
        this.state = state;
        this.name = "WorkflowSuspendedError";
    }
}
