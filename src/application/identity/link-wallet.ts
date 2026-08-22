import { ConflictError, NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { Clock } from "@/domain/shared/ports";
import { MochimoAddress } from "@/domain/wallet/mochimo-address";
import type { MeshGateway } from "@/domain/wallet/ports";
import { SettleReferral } from "@/application/rewards/settle-referral";
import type { UnitOfWork } from "@/application/shared/unit-of-work";

export type LinkWalletOutput = {
  hex: string;
  tag: string;
  meshVerified: boolean;
  balanceMcm?: string;
  meshNote?: string;
};

/**
 * Attach a wallet to an account that signed up through X.
 *
 * Mesh is consulted for *format* validity only, and a network failure
 * soft-fails to "unknown" rather than blocking: a flaky public node must never
 * be able to lock users out of their own account.
 */
export class LinkWallet {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly mesh: MeshGateway,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: string; hex: string; tag: string }): Promise<LinkWalletOutput> {
    const address = MochimoAddress.create(input);

    const check = await this.mesh.checkAddress(address);
    if (check.ok === false) {
      throw new ValidationError("wallet.rejected", `Hex rejected by Mesh: ${check.reason}`, "hex");
    }

    const now = this.clock.now();

    return this.uow.run(async (repos) => {
      const user = await repos.users.findById(input.userId);
      if (!user) throw new NotFoundError("user.not_found", "Account not found");

      const conflict = await repos.users.findConflicting({
        address,
        excludeUserId: user.id,
      });
      if (conflict) {
        throw new ConflictError(
          "wallet.taken",
          "This wallet is already linked to another account.",
        );
      }

      user.linkWallet(address);
      await repos.users.save(user);

      // Linking a wallet can be the last thing an invitee needed to qualify.
      await SettleReferral.execute(repos, { inviteeId: user.id, now });

      return {
        hex: address.hex,
        tag: address.tag,
        meshVerified: check.ok === true,
        balanceMcm: check.ok === true ? check.balanceMcm : undefined,
        meshNote: check.ok === "unknown" ? check.reason : undefined,
      };
    });
  }
}
