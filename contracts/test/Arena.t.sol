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
        uint8 factId = uint8(seed % 10);

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

    function test_StatsNeverDecideAKnowledgeTie() public {
        // Wildly different stats, both agents know nothing — a weak-stat agent should
        // still be able to win, proving attack/defense/speed no longer influence the
        // outcome at all (only knowledge, then a fair coin via rock-paper-scissors).
        vm.prank(relayer);
        uint256 weak = arena.createAgent(address(this), "Weak", "A", "F", 1, 1, 1, 0);
        vm.prank(relayer);
        uint256 strong = arena.createAgent(address(this), "Strong", "A", "F", 99, 99, 99, 0);

        bool weakWonAtLeastOnce = false;
        for (uint256 i = 0; i < 25; i++) {
            vm.roll(block.number + 1);
            (bool ok, bytes memory ret) = address(arena).call(
                abi.encodeWithSignature("battle(uint256,uint256)", weak, strong)
            );
            require(ok, "battle reverted");
            (uint256 winnerId, ) = abi.decode(ret, (uint256, uint256));
            if (winnerId == weak) {
                weakWonAtLeastOnce = true;
                break;
            }
        }
        assertTrue(weakWonAtLeastOnce, "the far weaker-stat agent should win at least once in 25 tries");
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

    function test_LossGrantsComebackSlot_WinResetsParity() public {
        uint256 idA = _create("Dominant", 0);
        uint256 idB = _create("Middling", 0);
        uint256 idC = _create("Weakest", 0);

        // Battle 1: force A to beat B via knowledge (stats no longer decide anything, so
        // predict the fact this exact block state will draw and teach it to A only).
        vm.roll(block.number + 1);
        uint256 t0 = block.timestamp + 46;
        vm.warp(t0);
        uint8 fact1 = uint8(
            uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.prevrandao, t0, idA, idB))) % 10
        );
        vm.prank(relayer);
        arena.train(idA, fact1);

        (uint256 winner1, ) = arena.battle(idA, idB);
        assertEq(winner1, idA);

        Arena.Agent memory bAfterLoss = arena.getAgent(idB);
        assertEq(bAfterLoss.knowledgeCap, 6, "a loss should grant the 6th comeback slot");

        // Fill B up to its new cap of 6, guaranteeing the 6th (last-trained) fact is
        // whichever one battle(idB, idC) will draw at the final timestamp below — so B's
        // win is knowledge-decided regardless of C (who knows nothing either way).
        vm.roll(block.number + 1);
        uint256 tBeforeFiller = block.timestamp;
        uint256 tFinal = tBeforeFiller + 6 * 46;
        uint8 fact2 = uint8(
            uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.prevrandao, tFinal, idB, idC))) % 10
        );

        uint8[5] memory filler;
        uint8 next = 0;
        for (uint8 i = 0; i < 5; i++) {
            while (next == fact2) next++;
            filler[i] = next;
            next++;
        }
        // Precompute every warp target up front — via_ir has previously miscompiled
        // `vm.warp(someVar + expr)` reads inside a loop as if re-reading a live
        // block.timestamp each iteration instead of the captured value, causing
        // compounding (quadratic) timestamps and spurious cooldown reverts.
        uint256[5] memory fillerTimestamps = [
            tBeforeFiller + 46,
            tBeforeFiller + 92,
            tBeforeFiller + 138,
            tBeforeFiller + 184,
            tBeforeFiller + 230
        ];
        for (uint8 i = 0; i < 5; i++) {
            vm.warp(fillerTimestamps[i]);
            vm.prank(relayer);
            arena.train(idB, filler[i]);
        }
        vm.warp(tFinal);
        vm.prank(relayer);
        arena.train(idB, fact2);

        Arena.Agent memory bTrained = arena.getAgent(idB);
        assertEq(_popcount(bTrained.knowledge), 6);
        assertEq(bTrained.lastFactTaught, fact2);

        (uint256 winner2, ) = arena.battle(idB, idC);
        assertEq(winner2, idB, "B should win via knowledge of the drawn fact");

        Arena.Agent memory bAfterWin = arena.getAgent(idB);
        assertEq(bAfterWin.knowledgeCap, 5, "a win off the comeback slot should reset the cap to 5");
        assertEq(_popcount(bAfterWin.knowledge), 5, "the bonus fact should be forgotten");
        assertEq(bAfterWin.knowledge & (uint32(1) << fact2), 0, "specifically the 6th trained fact should be cleared");
    }

    function _popcount(uint32 x) internal pure returns (uint8 count) {
        while (x != 0) {
            x &= x - 1;
            count++;
        }
    }
}
