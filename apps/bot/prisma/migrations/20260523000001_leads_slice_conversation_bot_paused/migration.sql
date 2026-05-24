-- Slice 1: Leads — adicionar botPaused em Conversation
ALTER TABLE "Conversation" ADD COLUMN "botPaused" BOOLEAN NOT NULL DEFAULT false;
