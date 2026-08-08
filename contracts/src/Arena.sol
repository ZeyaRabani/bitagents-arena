// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Arena - BitAgents on-chain battler
/// @notice Players spawn AI-flavored agents, teach them facts from a shared pool, and
///         pit them against each other. Whoever taught the drawn fact wins the round;
///         if it's a knowledge tie, stats settle it. Every result updates a real Elo
///         rating, fully on-chain and independently verifiable.
contract Arena {
    struct Agent {
        uint256 id;
        address owner;
        string name;
        string ability;
        string flavor;
        uint8 attack;
        uint8 defense;
        uint8 speed;
        uint32 wins;
        uint32 losses;
        uint32 rating;
        uint32 knowledge; // bitmask over FACT_COUNT facts
        uint8 knowledgeCap; // how many facts this agent may know right now
        uint8 lastFactTaught; // most recent train() target, used to enforce parity on a win
        uint64 createdAt;
        uint64 lastTrainedAt;
    }

    address public relayer;
    uint256 public nextId = 1;

    uint256 public constant FACT_COUNT = 10;
    uint256 public constant TRAIN_COOLDOWN = 45 seconds;
    uint32 public constant STARTING_RATING = 1000;
    uint32 public constant MIN_RATING = 100;
    uint256 public constant K_FACTOR = 40;
    uint8 public constant BASE_KNOWLEDGE_CAP = 5;
    uint8 public constant COMEBACK_KNOWLEDGE_CAP = 6;
    uint8 internal constant NO_FACT = type(uint8).max;

    mapping(uint256 => Agent) public agents;
    uint256[] public agentIds;
    mapping(bytes32 => uint256) public nameToId;

    event AgentCreated(
        uint256 indexed id,
        address indexed owner,
        string name,
        string ability,
        uint8 attack,
        uint8 defense,
        uint8 speed,
        uint32 knowledge
    );

    event AgentTrained(uint256 indexed id, uint8 factId, uint32 knowledge);

    event BattleResolved(
        uint256 indexed winnerId,
        uint256 indexed loserId,
        uint8 factId,
        bool decidedByKnowledge,
        uint256 winnerRoll,
        uint256 loserRoll,
        uint256 ratingDelta,
        uint32 winnerRatingAfter,
        uint32 loserRatingAfter,
        uint256 timestamp
    );

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Arena: not relayer");
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

    /// @notice Create a new agent, permanently binding `name` to its id/hash so nobody
    ///         else can claim that name. `initialKnowledge` is a bitmask of facts taught
    ///         during onboarding (bounded client-side to a small starting budget).
    function createAgent(
        address owner,
        string calldata name,
        string calldata ability,
        string calldata flavor,
        uint8 attack,
        uint8 defense,
        uint8 speed,
        uint32 initialKnowledge
    ) external onlyRelayer returns (uint256 id) {
        require(attack > 0 && defense > 0 && speed > 0, "Arena: zero stat");
        require(bytes(name).length > 0, "Arena: empty name");
        require(_popcount(initialKnowledge) <= BASE_KNOWLEDGE_CAP, "Arena: too much starting knowledge");
        bytes32 nameHash = keccak256(bytes(name));
        require(nameToId[nameHash] == 0, "Arena: name taken");

        id = nextId++;
        agents[id] = Agent({
            id: id,
            owner: owner,
            name: name,
            ability: ability,
            flavor: flavor,
            attack: attack,
            defense: defense,
            speed: speed,
            wins: 0,
            losses: 0,
            rating: STARTING_RATING,
            knowledge: initialKnowledge,
            knowledgeCap: BASE_KNOWLEDGE_CAP,
            lastFactTaught: NO_FACT,
            createdAt: uint64(block.timestamp),
            lastTrainedAt: uint64(block.timestamp)
        });
        agentIds.push(id);
        nameToId[nameHash] = id;

        emit AgentCreated(id, owner, name, ability, attack, defense, speed, initialKnowledge);
    }

    /// @notice Teach an agent one more fact from the shared pool. Cooldown-gated so
    ///         training paces out over the event instead of being spammable.
    function train(uint256 agentId, uint8 factId) external onlyRelayer {
        Agent storage a = agents[agentId];
        require(a.id != 0, "Arena: unknown agent");
        require(factId < FACT_COUNT, "Arena: bad fact id");
        require(block.timestamp >= a.lastTrainedAt + TRAIN_COOLDOWN, "Arena: cooldown");
        require(_popcount(a.knowledge) < a.knowledgeCap, "Arena: at knowledge cap");
        uint32 bit = uint32(1) << factId;
        require(a.knowledge & bit == 0, "Arena: already known");

        a.knowledge |= bit;
        a.lastFactTaught = factId;
        a.lastTrainedAt = uint64(block.timestamp);

        emit AgentTrained(agentId, factId, a.knowledge);
    }

    /// @notice Resolve a battle. A fact is drawn pseudo-randomly; whichever agent was
    ///         taught it wins outright. If both or neither know it, attack/speed stats
    ///         (with a random roll) decide instead. Elo ratings update either way.
    function battle(uint256 idA, uint256 idB) external returns (uint256 winnerId, uint256 loserId) {
        require(idA != idB, "Arena: same agent");
        Agent storage a = agents[idA];
        Agent storage b = agents[idB];
        require(a.id != 0 && b.id != 0, "Arena: unknown agent");

        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(blockhash(block.number - 1), block.prevrandao, block.timestamp, idA, idB)
            )
        );

        uint8 factId = uint8(seed % FACT_COUNT);
        bool aKnows = (a.knowledge >> factId) & 1 == 1;
        bool bKnows = (b.knowledge >> factId) & 1 == 1;

        uint256 rollA = (seed % 50) + uint256(a.attack) * 3 + a.speed;
        uint256 rollB = ((seed >> 128) % 50) + uint256(b.attack) * 3 + b.speed;
        rollA = rollA > b.defense ? rollA - b.defense / 2 : rollA;
        rollB = rollB > a.defense ? rollB - a.defense / 2 : rollB;

        bool decidedByKnowledge = aKnows != bKnows;
        uint256 winnerRoll;
        uint256 loserRoll;

        if (decidedByKnowledge) {
            winnerId = aKnows ? idA : idB;
            loserId = aKnows ? idB : idA;
            winnerRoll = aKnows ? rollA : rollB;
            loserRoll = aKnows ? rollB : rollA;
        } else if (rollA >= rollB) {
            winnerId = idA;
            loserId = idB;
            winnerRoll = rollA;
            loserRoll = rollB;
        } else {
            winnerId = idB;
            loserId = idA;
            winnerRoll = rollB;
            loserRoll = rollA;
        }

        Agent storage winner = agents[winnerId];
        Agent storage loser = agents[loserId];

        winner.wins += 1;
        loser.losses += 1;

        // Parity: a loss earns a comeback 6th training slot; a win that was riding that
        // 6th slot resets back to the base 5 and forgets whatever was taught into it.
        if (loser.knowledgeCap < COMEBACK_KNOWLEDGE_CAP) {
            loser.knowledgeCap = COMEBACK_KNOWLEDGE_CAP;
        }
        if (winner.knowledgeCap == COMEBACK_KNOWLEDGE_CAP) {
            winner.knowledgeCap = BASE_KNOWLEDGE_CAP;
            if (
                _popcount(winner.knowledge) > BASE_KNOWLEDGE_CAP &&
                winner.lastFactTaught != NO_FACT &&
                (winner.knowledge >> winner.lastFactTaught) & 1 == 1
            ) {
                winner.knowledge &= ~(uint32(1) << winner.lastFactTaught);
                winner.lastFactTaught = NO_FACT;
            }
        }

        uint256 ratingDelta = _ratingDelta(winner.rating, loser.rating);
        winner.rating = uint32(uint256(winner.rating) + ratingDelta);
        loser.rating = loser.rating > ratingDelta + MIN_RATING
            ? uint32(uint256(loser.rating) - ratingDelta)
            : MIN_RATING;

        emit BattleResolved(
            winnerId,
            loserId,
            factId,
            decidedByKnowledge,
            winnerRoll,
            loserRoll,
            ratingDelta,
            winner.rating,
            loser.rating,
            block.timestamp
        );
    }

    /// @dev Elo rating delta for the winner, using a piecewise-linear approximation of
    ///      the standard logistic expectancy curve (Solidity has no cheap fixed-point exp).
    function _ratingDelta(uint32 winnerRating, uint32 loserRating) internal pure returns (uint256) {
        int256 diff = int256(uint256(winnerRating)) - int256(uint256(loserRating));
        uint256 expectedBP = _expectedScoreBP(diff);
        uint256 changeBP = 10000 - expectedBP; // actual score for a win = 10000 bp
        return (K_FACTOR * changeBP) / 10000;
    }

    function _expectedScoreBP(int256 diff) internal pure returns (uint256) {
        if (diff <= -400) return 900;
        if (diff >= 400) return 9100;

        int256[9] memory xs = [int256(-400), -300, -200, -100, 0, 100, 200, 300, 400];
        uint256[9] memory ys = [uint256(900), 1500, 2400, 3600, 5000, 6400, 7600, 8500, 9100];

        for (uint256 i = 0; i < 8; i++) {
            if (diff >= xs[i] && diff <= xs[i + 1]) {
                int256 span = xs[i + 1] - xs[i];
                int256 offset = diff - xs[i];
                uint256 yLo = ys[i];
                uint256 yHi = ys[i + 1];
                return yLo + (uint256(offset) * (yHi - yLo)) / uint256(span);
            }
        }
        return 5000;
    }

    function _popcount(uint32 x) internal pure returns (uint8 count) {
        while (x != 0) {
            x &= x - 1;
            count++;
        }
    }

    function getAgent(uint256 id) external view returns (Agent memory) {
        return agents[id];
    }

    function getAgentByName(string calldata name) external view returns (Agent memory) {
        return agents[nameToId[keccak256(bytes(name))]];
    }

    function totalAgents() external view returns (uint256) {
        return agentIds.length;
    }

    function getAgents(uint256 offset, uint256 limit) external view returns (Agent[] memory page) {
        uint256 total = agentIds.length;
        if (offset >= total) {
            return new Agent[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        page = new Agent[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = agents[agentIds[i]];
        }
    }
}
