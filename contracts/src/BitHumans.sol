// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BitHumans - real-stakes multiple-choice trivia, human vs human
/// @notice Every player gets a starting balance (in cents, testnet-only — this is not
///         real money). Matches wager a fixed amount on a Monad/crypto multiple-choice
///         question; whoever answers correctly takes the pot. If both or neither answer
///         correctly, whoever answered faster wins instead — this is a speed game, not a
///         coinflip. Battle Royale pools everyone's entry up front and pays the sole
///         survivor the whole pot. Balances quietly drip back over time so nobody is
///         ever fully out.
contract BitHumans {
    struct UserAcct {
        uint256 id;
        address owner;
        string name;
        uint32 balance; // cents
        uint32 wins;
        uint32 losses;
        uint64 createdAt;
        uint64 lastDripAt;
    }

    address public relayer;
    uint256 public nextId = 1;

    uint32 public constant INITIAL_GRANT = 30; // $0.30
    uint32 public constant WAGER = 5; // $0.05
    uint32 public constant DRIP_AMOUNT = 1; // $0.01
    uint64 public constant DRIP_INTERVAL = 30 seconds;
    uint32 public constant DRIP_CAP = 15; // drip stops topping up once balance reaches $0.15

    mapping(uint256 => UserAcct) public users;
    uint256[] public userIds;
    mapping(bytes32 => uint256) public nameToId;

    event UserCreated(uint256 indexed id, address indexed owner, string name, uint32 balance);

    event MatchResolved(
        uint256 indexed winnerId,
        uint256 indexed loserId,
        uint8 questionId,
        bool decidedByAnswer,
        uint32 winnerAnswerMs,
        uint32 loserAnswerMs,
        uint32 wager,
        uint32 winnerBalanceAfter,
        uint32 loserBalanceAfter,
        uint256 timestamp
    );

    event RoyaleEntriesLocked(uint256[] userIds, uint32 potAmount);
    event RoyaleRoundResolved(
        uint256 indexed winnerId,
        uint256 indexed loserId,
        uint8 questionId,
        bool decidedByAnswer,
        uint32 winnerAnswerMs,
        uint32 loserAnswerMs
    );
    event RoyaleChampionPaid(uint256 indexed championId, uint32 potAmount, uint32 balanceAfter);

    modifier onlyRelayer() {
        require(msg.sender == relayer, "BitHumans: not relayer");
        _;
    }

    constructor(address _relayer) {
        relayer = _relayer;
    }

    function setRelayer(address _relayer) external onlyRelayer {
        relayer = _relayer;
    }

    function isNameTaken(string calldata name) external view returns (bool) {
        return nameToId[keccak256(bytes(name))] != 0;
    }

    /// @notice Create a player, permanently binding `name` to their id/hash, and grant
    ///         the starting balance. Testnet play money only.
    function createUser(address owner, string calldata name) external onlyRelayer returns (uint256 id) {
        require(bytes(name).length > 0, "BitHumans: empty name");
        bytes32 nameHash = keccak256(bytes(name));
        require(nameToId[nameHash] == 0, "BitHumans: name taken");

        id = nextId++;
        users[id] = UserAcct({
            id: id,
            owner: owner,
            name: name,
            balance: INITIAL_GRANT,
            wins: 0,
            losses: 0,
            createdAt: uint64(block.timestamp),
            lastDripAt: uint64(block.timestamp)
        });
        userIds.push(id);
        nameToId[nameHash] = id;

        emit UserCreated(id, owner, name, INITIAL_GRANT);
    }

    /// @dev Applies any accrued drip (capped) directly to storage. Called at the start of
    ///      every balance-touching function so on-chain balances are always current.
    function _settleDrip(UserAcct storage u) internal {
        if (u.balance >= DRIP_CAP) {
            u.lastDripAt = uint64(block.timestamp);
            return;
        }
        uint256 elapsed = block.timestamp - u.lastDripAt;
        uint256 ticks = elapsed / DRIP_INTERVAL;
        if (ticks == 0) return;

        uint256 accrued = ticks * DRIP_AMOUNT;
        uint256 newBalance = uint256(u.balance) + accrued;
        if (newBalance > DRIP_CAP) newBalance = DRIP_CAP;

        u.balance = uint32(newBalance);
        u.lastDripAt = uint64(u.lastDripAt + ticks * DRIP_INTERVAL);
    }

    /// @notice Preview a user's balance including drip accrued since the last on-chain
    ///         write, without spending gas to settle it.
    function previewBalance(uint256 id) external view returns (uint32) {
        UserAcct memory u = users[id];
        if (u.id == 0 || u.balance >= DRIP_CAP) return u.balance;
        uint256 elapsed = block.timestamp - u.lastDripAt;
        uint256 accrued = (elapsed / DRIP_INTERVAL) * DRIP_AMOUNT;
        uint256 newBalance = uint256(u.balance) + accrued;
        if (newBalance > DRIP_CAP) newBalance = DRIP_CAP;
        return uint32(newBalance);
    }

    /// @dev Shared resolution: whoever answered correctly wins outright. If both or
    ///      neither did, whoever answered faster wins — `answerMsA`/`answerMsB` are
    ///      milliseconds from question-shown to answer-submitted, timed by the relayer
    ///      (the same trust boundary as everything else it reports, e.g. which question
    ///      was actually asked). A player who never answered in time is passed a very
    ///      large sentinel so they can never win a speed tiebreak.
    function _decide(
        uint256 idA,
        uint256 idB,
        uint8 correctIndex,
        uint8 answerA,
        uint8 answerB,
        uint32 answerMsA,
        uint32 answerMsB
    ) internal pure returns (uint256 winnerId, uint256 loserId, bool decidedByAnswer, uint32 winnerAnswerMs, uint32 loserAnswerMs) {
        bool aCorrect = answerA == correctIndex;
        bool bCorrect = answerB == correctIndex;
        decidedByAnswer = aCorrect != bCorrect;

        if (decidedByAnswer) {
            winnerId = aCorrect ? idA : idB;
            loserId = aCorrect ? idB : idA;
        } else {
            bool aFaster = answerMsA <= answerMsB;
            winnerId = aFaster ? idA : idB;
            loserId = aFaster ? idB : idA;
        }
        winnerAnswerMs = winnerId == idA ? answerMsA : answerMsB;
        loserAnswerMs = winnerId == idA ? answerMsB : answerMsA;
    }

    /// @notice Resolve a wagered 1v1 match: both players staked WAGER, the winner takes
    ///         both stakes (net +WAGER for the winner, -WAGER for the loser).
    function resolveWagerMatch(
        uint256 idA,
        uint256 idB,
        uint8 questionId,
        uint8 correctIndex,
        uint8 answerA,
        uint8 answerB,
        uint32 answerMsA,
        uint32 answerMsB
    ) external onlyRelayer returns (uint256 winnerId, uint256 loserId) {
        require(idA != idB, "BitHumans: same user");
        UserAcct storage a = users[idA];
        UserAcct storage b = users[idB];
        require(a.id != 0 && b.id != 0, "BitHumans: unknown user");

        _settleDrip(a);
        _settleDrip(b);
        require(a.balance >= WAGER && b.balance >= WAGER, "BitHumans: insufficient balance");

        (uint256 wId, uint256 lId, bool decidedByAnswer, uint32 winnerAnswerMs, uint32 loserAnswerMs) =
            _decide(idA, idB, correctIndex, answerA, answerB, answerMsA, answerMsB);
        winnerId = wId;
        loserId = lId;

        UserAcct storage winner = users[winnerId];
        UserAcct storage loser = users[loserId];

        winner.balance += WAGER;
        loser.balance -= WAGER;
        winner.wins += 1;
        loser.losses += 1;

        emit MatchResolved(
            winnerId,
            loserId,
            questionId,
            decidedByAnswer,
            winnerAnswerMs,
            loserAnswerMs,
            WAGER,
            winner.balance,
            loser.balance,
            block.timestamp
        );
    }

    /// @notice Lock in a flat WAGER entry from every participant up front into a pot that
    ///         only the eventual Battle Royale champion will receive.
    function startRoyaleEntries(uint256[] calldata ids) external onlyRelayer returns (uint32 potAmount) {
        for (uint256 i = 0; i < ids.length; i++) {
            UserAcct storage u = users[ids[i]];
            require(u.id != 0, "BitHumans: unknown user");
            _settleDrip(u);
            require(u.balance >= WAGER, "BitHumans: insufficient balance");
            u.balance -= WAGER;
            potAmount += WAGER;
        }
        emit RoyaleEntriesLocked(ids, potAmount);
    }

    /// @notice Resolve one Battle Royale pairing. No money moves here — entries were
    ///         already locked up front; this only decides who advances.
    function resolveRoyaleRound(
        uint256 idA,
        uint256 idB,
        uint8 questionId,
        uint8 correctIndex,
        uint8 answerA,
        uint8 answerB,
        uint32 answerMsA,
        uint32 answerMsB
    ) external onlyRelayer returns (uint256 winnerId, uint256 loserId) {
        require(idA != idB, "BitHumans: same user");
        require(users[idA].id != 0 && users[idB].id != 0, "BitHumans: unknown user");

        (uint256 wId, uint256 lId, bool decidedByAnswer, uint32 winnerAnswerMs, uint32 loserAnswerMs) =
            _decide(idA, idB, correctIndex, answerA, answerB, answerMsA, answerMsB);
        winnerId = wId;
        loserId = lId;

        users[winnerId].wins += 1;
        users[loserId].losses += 1;

        emit RoyaleRoundResolved(winnerId, loserId, questionId, decidedByAnswer, winnerAnswerMs, loserAnswerMs);
    }

    /// @notice Pay the whole locked-in pot to the sole Battle Royale survivor.
    function payRoyaleChampion(uint256 championId, uint32 potAmount) external onlyRelayer {
        UserAcct storage champ = users[championId];
        require(champ.id != 0, "BitHumans: unknown user");
        _settleDrip(champ);
        champ.balance += potAmount;
        emit RoyaleChampionPaid(championId, potAmount, champ.balance);
    }

    function getUser(uint256 id) external view returns (UserAcct memory) {
        return users[id];
    }

    function getUserByName(string calldata name) external view returns (UserAcct memory) {
        return users[nameToId[keccak256(bytes(name))]];
    }

    function totalUsers() external view returns (uint256) {
        return userIds.length;
    }

    function getUsers(uint256 offset, uint256 limit) external view returns (UserAcct[] memory page) {
        uint256 total = userIds.length;
        if (offset >= total) {
            return new UserAcct[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        page = new UserAcct[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = users[userIds[i]];
        }
    }
}
