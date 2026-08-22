import { prisma } from "@/lib/prisma";
import { systemClock } from "@/domain/shared/ports";
import { RegistrationPolicy } from "@/domain/wallet/registration-policy";
import { LinkReferrer } from "@/application/identity/link-referrer";
import { LinkWallet } from "@/application/identity/link-wallet";
import { RegisterWithWallet } from "@/application/identity/register-with-wallet";
import { SignInWithCredentials } from "@/application/identity/sign-in-with-credentials";
import { ResetLeaderboard } from "@/application/rewards/reset-leaderboard";
import { ModerateProof } from "@/application/tasks/moderate-proof";
import { ReviewSubmission } from "@/application/tasks/review-submission";
import { SubmitTaskProof } from "@/application/tasks/submit-task-proof";
import { PollWalletClaim } from "@/application/wallet/poll-wallet-claim";
import { StartWalletClaim } from "@/application/wallet/start-wallet-claim";
import { LlmContentModerator } from "@/infrastructure/ai/llm-content-moderator";
import { registrationSettings } from "@/infrastructure/config/app-config";
import { nodeRandom } from "@/infrastructure/crypto/node-random";
import { ScryptPasswordHasher } from "@/infrastructure/crypto/scrypt-password-hasher";
import { MochimoMeshGateway } from "@/infrastructure/mesh/mochimo-mesh-gateway";
import { buildRepositories, PrismaUnitOfWork } from "@/infrastructure/prisma/unit-of-work";

/**
 * Composition root.
 *
 * The only module that knows which implementation satisfies which port.
 * Route handlers ask for a use case and get one already wired — swapping
 * Postgres for something else, or the Mesh gateway for a fake in a test, is a
 * change here and nowhere else.
 *
 * Policies are built per call rather than cached because `FREE_SIGNUP_MODE`
 * and the deposit wallet are read from the environment, which differs between
 * a dev server and a deploy — and stale config is exactly the kind of bug that
 * shows up only in production.
 */
function registrationPolicy() {
  return new RegistrationPolicy(registrationSettings());
}

function repositories() {
  return buildRepositories(prisma, prisma);
}

function unitOfWork() {
  return new PrismaUnitOfWork(prisma);
}

function meshGateway() {
  return new MochimoMeshGateway();
}

export const useCases = {
  startWalletClaim: () =>
    new StartWalletClaim(
      repositories().claims,
      repositories().users,
      registrationPolicy(),
      nodeRandom,
      systemClock,
    ),

  pollWalletClaim: () =>
    new PollWalletClaim(repositories().claims, meshGateway(), registrationPolicy(), systemClock),

  registerWithWallet: () =>
    new RegisterWithWallet(
      unitOfWork(),
      registrationPolicy(),
      new ScryptPasswordHasher(),
      nodeRandom,
      systemClock,
    ),

  signInWithCredentials: () =>
    new SignInWithCredentials(
      repositories().users,
      repositories().sessions,
      new ScryptPasswordHasher(),
      nodeRandom,
      systemClock,
    ),

  linkWallet: () => new LinkWallet(unitOfWork(), meshGateway(), systemClock),

  linkReferrer: () => new LinkReferrer(repositories().users),

  submitTaskProof: () =>
    new SubmitTaskProof(unitOfWork(), repositories(), new LlmContentModerator(), systemClock),

  reviewSubmission: () => new ReviewSubmission(unitOfWork(), systemClock),

  moderateProof: () => new ModerateProof(repositories().users, new LlmContentModerator()),

  resetLeaderboard: () => new ResetLeaderboard(repositories().leaderboard, systemClock),
};
