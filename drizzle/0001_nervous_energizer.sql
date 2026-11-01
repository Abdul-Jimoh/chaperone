ALTER TYPE "public"."payment_status" ADD VALUE 'capturing' BEFORE 'captured';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'voiding' BEFORE 'captured';