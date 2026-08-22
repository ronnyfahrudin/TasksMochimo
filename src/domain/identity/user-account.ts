import { ConflictError, ForbiddenError } from "@/domain/shared/errors";
import { MochimoAddress } from "@/domain/wallet/mochimo-address";
import { PasswordHash, Username, type UserRole } from "./value-objects";

export type UserAccountSnapshot = {
  id: string | null;
  username: string | null;
  passwordHash: string | null;
  role: UserRole;
  mochimoAddress: string | null;
  mochimoTag: string | null;
  referralCode: string | null;
  referredById: string | null;
  twitterHandle: string | null;
  bannedAt: Date | null;
  referralPaidAt: Date | null;
  signupIpHash: string | null;
};

/**
 * Aggregate root for a participant.
 *
 * Two ways in — wallet+password, or X OAuth — but one set of rules about what
 * an account may do, which is why they share this object rather than each
 * sign-in route re-deciding.
 */
export class UserAccount {
  private constructor(
    private _id: string | null,
    private _username: Username | null,
    private _passwordHash: PasswordHash | null,
    private _role: UserRole,
    private _address: MochimoAddress | null,
    private _referralCode: string | null,
    private _referredById: string | null,
    private _twitterHandle: string | null,
    private _bannedAt: Date | null,
    private _referralPaidAt: Date | null,
    private _signupIpHash: string | null,
  ) {}

  /** Open a new wallet-first account. The claim is proof; this is the record. */
  static register(params: {
    username: Username;
    passwordHash: PasswordHash;
    address: MochimoAddress;
    referredById?: string | null;
    /** Salted fingerprint of the sign-up origin; null when unknown. */
    signupIpHash?: string | null;
  }): UserAccount {
    return new UserAccount(
      null,
      params.username,
      params.passwordHash,
      "USER",
      params.address,
      null,
      params.referredById ?? null,
      null,
      null,
      null,
      params.signupIpHash ?? null,
    );
  }

  static rehydrate(s: UserAccountSnapshot): UserAccount {
    return new UserAccount(
      s.id,
      s.username ? Username.rehydrate(s.username) : null,
      s.passwordHash ? PasswordHash.rehydrate(s.passwordHash) : null,
      s.role,
      // The hex IS the wallet — it is what Mesh verifies and what payouts use.
      // The tag is a display form and may legitimately be absent on older
      // rows; requiring both would lock those accounts out of every non-DAILY
      // task AND make linkWallet report a first link again, paying the
      // referral bonus twice.
      s.mochimoAddress ? MochimoAddress.rehydrate(s.mochimoAddress, s.mochimoTag ?? "") : null,
      s.referralCode,
      s.referredById,
      s.twitterHandle,
      s.bannedAt,
      s.referralPaidAt,
      s.signupIpHash,
    );
  }

  get id(): string {
    if (!this._id) throw new Error("UserAccount has not been persisted yet");
    return this._id;
  }

  get username(): Username | null {
    return this._username;
  }

  get passwordHash(): PasswordHash | null {
    return this._passwordHash;
  }

  get role(): UserRole {
    return this._role;
  }

  get address(): MochimoAddress | null {
    return this._address;
  }

  get referredById(): string | null {
    return this._referredById;
  }

  get referralCode(): string | null {
    return this._referralCode;
  }

  get referralPaidAt(): Date | null {
    return this._referralPaidAt;
  }

  get signupIpHash(): string | null {
    return this._signupIpHash;
  }

  get bannedAt(): Date | null {
    return this._bannedAt;
  }

  /** Record that this account's referrer has been paid. Once, ever. */
  markReferralPaid(now: Date): void {
    if (this._referralPaidAt) {
      throw new ConflictError("referral.already_paid", "Referral bonus already paid");
    }
    this._referralPaidAt = now;
  }

  get isBanned(): boolean {
    return this._bannedAt !== null;
  }

  get hasWallet(): boolean {
    return this._address !== null;
  }

  get canModerate(): boolean {
    return this._role === "ADMIN" || this._role === "MODERATOR";
  }

  /** Guard for every action a suspended account must not perform. */
  assertActive(): void {
    if (this.isBanned) {
      throw new ForbiddenError("Account suspended.");
    }
  }

  assertCanModerate(): void {
    if (!this.canModerate) throw new ForbiddenError();
  }

  /**
   * Bind a wallet to this account (the X-first path; wallet-first accounts are
   * born with one).
   *
   * Returns whether this was the *first* wallet — the moment a referral
   * becomes real, since a referred account with no wallet can never be paid.
   */
  linkWallet(address: MochimoAddress): { wasFirstLink: boolean } {
    const wasFirstLink = !this._address;
    this._address = address;
    return { wasFirstLink };
  }

  /** Attribute this account to a referrer. Only ever settled once. */
  attributeTo(referrerId: string): void {
    if (this._referredById) {
      throw new ConflictError("referral.already_linked", "Referrer already set");
    }
    if (this._id && referrerId === this._id) {
      throw new ConflictError("referral.self", "Cannot refer yourself");
    }
    this._referredById = referrerId;
  }

  assignId(id: string): void {
    this._id = id;
  }

  toSnapshot(): UserAccountSnapshot {
    return {
      id: this._id,
      username: this._username?.value ?? null,
      passwordHash: this._passwordHash?.value ?? null,
      role: this._role,
      mochimoAddress: this._address?.hex ?? null,
      mochimoTag: this._address?.tag || null,
      referralCode: this._referralCode,
      referredById: this._referredById,
      twitterHandle: this._twitterHandle,
      bannedAt: this._bannedAt,
      referralPaidAt: this._referralPaidAt,
      signupIpHash: this._signupIpHash,
    };
  }
}
