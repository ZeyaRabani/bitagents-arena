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
        uint256 t0 = block.timestamp;
        uint256 id = _create("Zex", 0);
        vm.warp(t0 + 46); // cooldown counts from creation too
        vm.prank(relayer);
        arena.train(id, 1);

        vm.prank(relayer);
        vm.expectRevert("Arena: cooldown");
        arena.train(id, 2);

        vm.warp(t0 + 92);
        vm.prank(relayer);
        arena.train(id, 2);

        Arena.Agent memory a = arena.getAgent(id);
        assertEq(a.knowledge, (1 << 1) | (1 << 2));
    }

    function test_KnowledgeDecidesBattle_RegardlessOfStats() public {
        vm.roll(block.number + 1);

        // idA/idB ids are 1/2 pre-creation; predict the fact battle() will draw for this
        // exact block state so we can arrange for only the weak agent to know it.
        uint256 idA = 1;
        uint256 idB = 2;
        uint256 seed = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), block.prevrandao, block.timestamp, idA, idB))
        );
        uint8 factId = uint8(seed % 32);

        // idA has terrible stats but knows the one fact that'll be drawn; idB has great
        // stats but knows nothing — knowledge should still decide it.
        vm.prank(relayer);
        arena.createAgent(address(this), "Weak", "A", "F", 1, 1, 1, uint32(1) << factId);
        vm.prank(relayer);
        arena.createAgent(address(this), "Strong", "A", "F", 99, 99, 99, 0);

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

    function test_StartingKnowledgeCannotExceedBaseCap() public {
        vm.prank(relayer);
        vm.expectRevert("Arena: too much starting knowledge");
        arena.createAgent(address(this), "Greedy", "A", "F", 30, 30, 30, uint32((1 << 6) - 1)); // 6 facts
    }

    function _trainN(uint256 id, uint8 count) internal {
        uint256 t0 = block.timestamp;
        for (uint8 i = 0; i < count; i++) {
            vm.warp(t0 + uint256(i + 1) * 46);
            vm.prank(relayer);
            arena.train(id, i);
        }
    }

    function test_LossGrantsComebackSlot_WinResetsParity() public {
        vm.prank(relayer);
        uint256 idA = arena.createAgent(address(this), "Dominant", "A", "F", 99, 99, 99, 0);
        vm.prank(relayer);
        uint256 idB = arena.createAgent(address(this), "Middling", "A", "F", 50, 50, 50, 0);
        vm.prank(relayer);
        uint256 idC = arena.createAgent(address(this), "Weakest", "A", "F", 1, 1, 1, 0);

        // Battle 1: A crushes B on stats (both know nothing, so it's never knowledge-decided).
        vm.roll(block.number + 1);
        (uint256 winner1, ) = arena.battle(idA, idB);
        assertEq(winner1, idA);

        Arena.Agent memory bAfterLoss = arena.getAgent(idB);
        assertEq(bAfterLoss.knowledgeCap, 6, "a loss should grant the 6th comeback slot");

        // Fill B up to its new cap of 6.
        _trainN(idB, 6);
        Arena.Agent memory bTrained = arena.getAgent(idB);
        assertEq(bTrained.knowledge, uint32((1 << 6) - 1));

        // Battle 2: B beats C on stats (C never knows anything, so this is deterministic
        // regardless of which fact gets drawn).
        vm.roll(block.number + 2);
        (uint256 winner2, ) = arena.battle(idB, idC);
        assertEq(winner2, idB);

        Arena.Agent memory bAfterWin = arena.getAgent(idB);
        assertEq(bAfterWin.knowledgeCap, 5, "a win off the comeback slot should reset the cap to 5");
        assertEq(_popcount(bAfterWin.knowledge), 5, "the bonus fact should be forgotten");
        assertEq(bAfterWin.knowledge & (1 << 5), 0, "specifically the 6th trained fact should be cleared");
    }

    function _popcount(uint32 x) internal pure returns (uint8 count) {
        while (x != 0) {
            x &= x - 1;
            count++;
        }
    }
}
