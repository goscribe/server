import Pusher from 'pusher';

// Server-side Pusher instance
export const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.PUSHER_CLUSTER || 'us2',
  useTLS: true,
});

// Pusher service for managing notifications
export class PusherService {
  // Emit task completion notification
  static async emitTaskComplete(workspaceId: string, event: string, data: any) {
    try {
      const channel = `workspace_${workspaceId}`;
      const eventName = `${workspaceId}_${event}`;
      await pusher.trigger(channel, eventName, data);
      console.log(`📡 Pusher notification sent: ${eventName} to ${channel}`);
    } catch (error) {
      console.error('❌ Pusher notification error:', error);
    }
  }

  // Emit AI analysis completion
  static async emitAnalysisComplete(workspaceId: string, analysisType: string, result: any) {
    await this.emitTaskComplete(workspaceId, `${analysisType}_ended`, {
      type: analysisType,
      result,
      timestamp: new Date().toISOString(),
    });
  }

  // Emit study guide completion
  static async emitStudyGuideComplete(workspaceId: string, artifact: any) {
    await this.emitAnalysisComplete(workspaceId, 'studyguide', {
      artifactId: artifact.id,
      title: artifact.title,
      status: 'completed'
    });
  }

  // Emit flashcard completion
  static async emitFlashcardComplete(workspaceId: string, artifact: any) {
    await this.emitAnalysisComplete(workspaceId, 'flashcard', {
      artifactId: artifact.id,
      title: artifact.title,
      status: 'completed'
    });
  }

  // Emit worksheet completion
  static async emitWorksheetComplete(workspaceId: string, artifact: any) {
    await this.emitAnalysisComplete(workspaceId, 'worksheet', {
      artifactId: artifact.id,
      title: artifact.title,
      status: 'completed'
    });
  }

  // Emit overall analysis completion
  static async emitOverallComplete(workspaceId: string, filename: string, artifacts: any) {
    await this.emitTaskComplete(workspaceId, 'analysis_ended', {
      filename,
      artifacts,
      timestamp: new Date().toISOString(),
    });
  }

  // Emit error notification
  static async emitError(workspaceId: string, error: string, analysisType?: string) {
    const event = analysisType ? `${analysisType}_error` : 'analysis_error';
    
    await this.emitTaskComplete(workspaceId, event, {
      error,
      analysisType,
      timestamp: new Date().toISOString(),
    });
  }
}

export default PusherService;
