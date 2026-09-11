use anchor_lang::prelude::*;

#[error_code]
pub enum DuelError {
    #[msg("New duels are paused")]
    Paused,
    #[msg("A duel needs two different stocks")]
    SameAsset,
    #[msg("That stock is not enabled for duels")]
    AssetDisabled,
    #[msg("Both stakes must be more than zero")]
    ZeroStake,
    #[msg("Give a duration or an end time, not both")]
    BadEndRule,
    #[msg("That duel length is out of range")]
    BadDuration,
    #[msg("The challenge must close before the duel could end")]
    BadExpiry,
    #[msg("The taunt is too long")]
    TauntTooLong,
    #[msg("The symbol is too long")]
    SymbolTooLong,
    #[msg("This duel is not open")]
    NotOpen,
    #[msg("This challenge has expired")]
    Expired,
    #[msg("Only the creator can cancel before the challenge expires")]
    NotCreator,
    #[msg("You cannot accept your own duel")]
    SelfDuel,
    #[msg("This challenge is for someone else")]
    NotInvitee,
    #[msg("This duel is not waiting for its start prices")]
    NotAccepted,
    #[msg("This duel is not live")]
    NotLive,
    #[msg("This duel cannot be refunded yet")]
    NotRefundable,
    #[msg("This duel is not finished")]
    NotFinished,
    #[msg("Not an account owned by the Pyth receiver")]
    NotPythAccount,
    #[msg("Not a Pyth PriceUpdateV2 account")]
    NotPriceUpdate,
    #[msg("The price update is only partially verified")]
    PartiallyVerified,
    #[msg("The price update is for a different feed")]
    WrongFeed,
    #[msg("That price was published before the boundary")]
    PriceTooEarly,
    #[msg("That is not the first price at or after the boundary")]
    NotFirstPrice,
    #[msg("The price is not positive")]
    BadPrice,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("That mint cannot be held in escrow")]
    UnsupportedMint,
    #[msg("The escrow did not receive the full stake")]
    ShortTransfer,
    #[msg("Unknown price source")]
    BadSource,
    #[msg("No oracle is configured for signed prices")]
    NoOracle,
    #[msg("No valid signed quote for this stock at this boundary")]
    NoSignedQuote,
    #[msg("That is not the instructions sysvar")]
    NotInstructionsSysvar,
}
