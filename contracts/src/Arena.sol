// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Arena - BitAgents on-chain battler
/// @notice Players spawn AI-flavored agents (stats derived off-chain from a prompt)
///         and pit them against each other. Combat is resolved fully on-chain so every
///         fight and every leaderboard position is independently verifiable.
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
        uint64 createdAt;
    }

    address public relayer;
    uint256 public nextId = 1;

    mapping(uint256 => Agent) public agents;
    uint256[] public agentIds;

    event AgentCreated(
        uint256 indexed id,
        address indexed owner,
        string name,
        string ability,
        uint8 attack,
        uint8 defense,
        uint8 speed
    );

    event BattleResolved(
        uint256 indexed winnerId,
        uint256 indexed loserId,
        uint256 winnerRoll,
        uint256 loserRoll,
        uint256 timestamp
    );

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Arena: not relayer");
        _;
    }

    constructor(address _relayer) {
        relayer = _relayer;
    }

    /// @notice Change the relayer allowed to submit gasless actions on players' behalf.
    function setRelayer(address _relayer) external onlyRelayer {
        relayer = _relayer;
    }

    /// @notice Create a new agent. Called by the relayer on behalf of a player so the
    ///         player never needs to hold MON or sign a transaction themselves.
    function createAgent(
        address owner,
        string calldata name,
        string calldata ability,
        string calldata flavor,
        uint8 attack,
        uint8 defense,
        uint8 speed
    ) external onlyRelayer returns (uint256 id) {
        require(attack > 0 && defense > 0 && speed > 0, "Arena: zero stat");

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
            createdAt: uint64(block.timestamp)
        });
        agentIds.push(id);

        emit AgentCreated(id, owner, name, ability, attack, defense, speed);
    }

    /// @notice Resolve a battle between two existing agents.
    /// @dev Deterministic on-chain "dice roll": each side's power is combined with a
    ///      pseudo-random roll seeded by chain state + both agent ids, so the outcome is
    ///      unknown beforehand but fully reproducible/auditable after the fact.
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

        uint256 rollA = (seed % 50) + a.attack * 3 + a.speed;
        uint256 rollB = ((seed >> 128) % 50) + b.attack * 3 + b.speed;

        rollA = rollA > b.defense ? rollA - b.defense / 2 : rollA;
        rollB = rollB > a.defense ? rollB - a.defense / 2 : rollB;

        uint256 winnerRoll;
        uint256 loserRoll;
        if (rollA >= rollB) {
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

        agents[winnerId].wins += 1;
        agents[loserId].losses += 1;

        emit BattleResolved(winnerId, loserId, winnerRoll, loserRoll, block.timestamp);
    }

    function getAgent(uint256 id) external view returns (Agent memory) {
        return agents[id];
    }

    function totalAgents() external view returns (uint256) {
        return agentIds.length;
    }

    /// @notice Paginated fetch so the frontend can page through the roster without
    ///         needing an indexer.
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
