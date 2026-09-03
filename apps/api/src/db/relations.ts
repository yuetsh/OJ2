import { relations } from "drizzle-orm/relations";
import { user, aiAnalysis, announcement, contest, problem, flowchartSubmission, message, submission, tutorial, exercise, problemset, problemsetProblem, problemsetProgress, problemsetSubmission, reaction, problemTags, problemTag, userStat, achievement, userAchievement, problemsetBadge, userBadge, userProfile, acmContestRank } from "./schema";

export const aiAnalysisRelations = relations(aiAnalysis, ({one}) => ({
	user: one(user, {
		fields: [aiAnalysis.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	aiAnalyses: many(aiAnalysis),
	announcements: many(announcement),
	contests: many(contest),
	flowchartSubmissions: many(flowchartSubmission),
	messages_recipientId: many(message, {
		relationName: "message_recipientId_user_id"
	}),
	messages_senderId: many(message, {
		relationName: "message_senderId_user_id"
	}),
	problemsets: many(problemset),
	problemsetProgresses: many(problemsetProgress),
	problemsetSubmissions: many(problemsetSubmission),
	reactions: many(reaction),
	problems: many(problem),
	tutorials: many(tutorial),
	userStats: many(userStat),
	userAchievements: many(userAchievement),
	userBadges: many(userBadge),
	userProfiles: many(userProfile),
	acmContestRanks: many(acmContestRank),
}));

export const announcementRelations = relations(announcement, ({one}) => ({
	user: one(user, {
		fields: [announcement.createdById],
		references: [user.id]
	}),
}));

export const contestRelations = relations(contest, ({one, many}) => ({
	user: one(user, {
		fields: [contest.createdById],
		references: [user.id]
	}),
	problems: many(problem),
	submissions: many(submission),
	acmContestRanks: many(acmContestRank),
}));

export const flowchartSubmissionRelations = relations(flowchartSubmission, ({one}) => ({
	problem: one(problem, {
		fields: [flowchartSubmission.problemId],
		references: [problem.id]
	}),
	user: one(user, {
		fields: [flowchartSubmission.userId],
		references: [user.id]
	}),
}));

export const problemRelations = relations(problem, ({one, many}) => ({
	flowchartSubmissions: many(flowchartSubmission),
	problemsetProblems: many(problemsetProblem),
	problemsetSubmissions: many(problemsetSubmission),
	reactions: many(reaction),
	contest: one(contest, {
		fields: [problem.contestId],
		references: [contest.id]
	}),
	user: one(user, {
		fields: [problem.createdById],
		references: [user.id]
	}),
	problemTags: many(problemTags),
	submissions: many(submission),
}));

export const messageRelations = relations(message, ({one}) => ({
	user_recipientId: one(user, {
		fields: [message.recipientId],
		references: [user.id],
		relationName: "message_recipientId_user_id"
	}),
	user_senderId: one(user, {
		fields: [message.senderId],
		references: [user.id],
		relationName: "message_senderId_user_id"
	}),
	submission: one(submission, {
		fields: [message.submissionId],
		references: [submission.id]
	}),
}));

export const submissionRelations = relations(submission, ({one, many}) => ({
	messages: many(message),
	problemsetSubmissions: many(problemsetSubmission),
	contest: one(contest, {
		fields: [submission.contestId],
		references: [contest.id]
	}),
	problem: one(problem, {
		fields: [submission.problemId],
		references: [problem.id]
	}),
}));

export const exerciseRelations = relations(exercise, ({one}) => ({
	tutorial: one(tutorial, {
		fields: [exercise.tutorialId],
		references: [tutorial.id]
	}),
}));

export const tutorialRelations = relations(tutorial, ({one, many}) => ({
	exercises: many(exercise),
	user: one(user, {
		fields: [tutorial.createdById],
		references: [user.id]
	}),
}));

export const problemsetRelations = relations(problemset, ({one, many}) => ({
	user: one(user, {
		fields: [problemset.createdById],
		references: [user.id]
	}),
	problemsetProblems: many(problemsetProblem),
	problemsetProgresses: many(problemsetProgress),
	problemsetSubmissions: many(problemsetSubmission),
	problemsetBadges: many(problemsetBadge),
}));

export const problemsetProblemRelations = relations(problemsetProblem, ({one}) => ({
	problem: one(problem, {
		fields: [problemsetProblem.problemId],
		references: [problem.id]
	}),
	problemset: one(problemset, {
		fields: [problemsetProblem.problemsetId],
		references: [problemset.id]
	}),
}));

export const problemsetProgressRelations = relations(problemsetProgress, ({one}) => ({
	problemset: one(problemset, {
		fields: [problemsetProgress.problemsetId],
		references: [problemset.id]
	}),
	user: one(user, {
		fields: [problemsetProgress.userId],
		references: [user.id]
	}),
}));

export const problemsetSubmissionRelations = relations(problemsetSubmission, ({one}) => ({
	problem: one(problem, {
		fields: [problemsetSubmission.problemId],
		references: [problem.id]
	}),
	problemset: one(problemset, {
		fields: [problemsetSubmission.problemsetId],
		references: [problemset.id]
	}),
	submission: one(submission, {
		fields: [problemsetSubmission.submissionId],
		references: [submission.id]
	}),
	user: one(user, {
		fields: [problemsetSubmission.userId],
		references: [user.id]
	}),
}));

export const reactionRelations = relations(reaction, ({one}) => ({
	problem: one(problem, {
		fields: [reaction.problemId],
		references: [problem.id]
	}),
	user: one(user, {
		fields: [reaction.userId],
		references: [user.id]
	}),
}));

export const problemTagsRelations = relations(problemTags, ({one}) => ({
	problem: one(problem, {
		fields: [problemTags.problemId],
		references: [problem.id]
	}),
	problemTag: one(problemTag, {
		fields: [problemTags.problemtagId],
		references: [problemTag.id]
	}),
}));

export const problemTagRelations = relations(problemTag, ({many}) => ({
	problemTags: many(problemTags),
}));

export const userStatRelations = relations(userStat, ({one}) => ({
	user: one(user, {
		fields: [userStat.userId],
		references: [user.id]
	}),
}));

export const userAchievementRelations = relations(userAchievement, ({one}) => ({
	achievement: one(achievement, {
		fields: [userAchievement.achievementId],
		references: [achievement.id]
	}),
	user: one(user, {
		fields: [userAchievement.userId],
		references: [user.id]
	}),
}));

export const achievementRelations = relations(achievement, ({many}) => ({
	userAchievements: many(userAchievement),
}));

export const userBadgeRelations = relations(userBadge, ({one}) => ({
	problemsetBadge: one(problemsetBadge, {
		fields: [userBadge.badgeId],
		references: [problemsetBadge.id]
	}),
	user: one(user, {
		fields: [userBadge.userId],
		references: [user.id]
	}),
}));

export const problemsetBadgeRelations = relations(problemsetBadge, ({one, many}) => ({
	userBadges: many(userBadge),
	problemset: one(problemset, {
		fields: [problemsetBadge.problemsetId],
		references: [problemset.id]
	}),
}));

export const userProfileRelations = relations(userProfile, ({one}) => ({
	user: one(user, {
		fields: [userProfile.userId],
		references: [user.id]
	}),
}));

export const acmContestRankRelations = relations(acmContestRank, ({one}) => ({
	contest: one(contest, {
		fields: [acmContestRank.contestId],
		references: [contest.id]
	}),
	user: one(user, {
		fields: [acmContestRank.userId],
		references: [user.id]
	}),
}));