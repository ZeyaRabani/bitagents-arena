// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Arena} from "../src/Arena.sol";

contract ArenaTest is Test {
    Arena arena;
    address relayer = address(0xBEEF);

    function setUp() public {
        arena = new Arena(relayer);
    }

    function _create(string memory name, uint32 knowledge) internal returns (uint256 id) {
        vm.prank(relayer);
        id = arena.createAgent(address(this), name, "Ability", "Flavor", 30, 30, 30, knowledge);
    }

    function test_NameUniqueness() public {
        _create("Zex", 0);
        vm.prank(relayer);
        vm.expectRevert("Arena: name taken");
        arena.createAgent(address(this), "Zex", "A", "F", 10, 10, 10, 0);
    }

    function test_TrainCooldown() public {
        uint256 id = _create("Zex", 0);
        vm.warp(block.timestamp + 46); // cooldown counts from creation too
        vm.prank(relayer);
        arena.train(id, 1);

        vm.prank(relayer);
        vm.expectRevert("Arena: cooldown");
        arena.train(id, 2);

        vm.warp(block.timestamp + 46);
        vm.prank(relayer);
        arena.train(id, 2);

        Arena.Agent memory a = arena.getAgent(id);
        assertEq(a.knowledge, (1 << 1) | (1 << 2));
    }

    function test_KnowledgeDecidesBattle_RegardlessOfStats() public {
        // idA has terrible stats but will know every fact; idB has great stats but knows nothing.
        vm.prank(relayer);
        uint256 idA = arena.createAgent(address(this), "Weak", "A", "F", 1, 1, 1, type(uint32).max);
        vm.prank(relayer);
        uint256 idB = arena.createAgent(address(this), "Strong", "A", "F", 99, 99, 99, 0);

        vm.roll(block.number + 1);
        (uint256 winnerId, uint256 loserId) = arena.battle(idA, idB);

        assertEq(winnerId, idA, "knowledgeable-but-weak agent should win");
        assertEq(loserId, idB);

        Arena.Agent memory winner = arena.getAgent(winnerId);
        Arena.Agent memory loser = arena.getAgent(loserId);
        assertEq(winner.wins, 1);
        assertEq(loser.losses, 1);
        assertGt(winner.rating, 1000, "winner rating should increase");
        assertLt(loser.rating, 1000, "loser rating should decrease");
    }

    function test_RatingSymmetricDeltaOnEqualStats() public {
        uint256 idA = _create("A", 0);
        uint256 idB = _create("B", 0);

        vm.roll(block.number + 1);
        (uint256 winnerId, uint256 loserId) = arena.battle(idA, idB);

        Arena.Agent memory winner = arena.getAgent(winnerId);
        Arena.Agent memory loser = arena.getAgent(loserId);

        uint256 winnerDelta = winner.rating - 1000;
        uint256 loserDelta = 1000 - loser.rating;
        assertEq(winnerDelta, loserDelta, "equal-rated players should trade equal rating");
    }

    function test_CannotRetrainKnownFact() public {
        uint256 id = _create("Zex", 1); // already knows fact 0
        vm.warp(block.timestamp + 46);
        vm.prank(relayer);
        vm.expectRevert("Arena: already known");
        arena.train(id, 0);
    }
}
