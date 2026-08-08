// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BitHumans} from "../src/BitHumans.sol";

contract BitHumansTest is Test {
    BitHumans bh;
    address relayer = address(0xBEEF);

    function setUp() public {
        bh = new BitHumans(relayer);
    }

    function _create(string memory name) internal returns (uint256 id) {
        vm.prank(relayer);
        id = bh.createUser(address(this), name);
    }

    function test_CreateUserGrantsStartingBalance() public {
        uint256 id = _create("Zeya");
        BitHumans.UserAcct memory u = bh.getUser(id);
        assertEq(u.balance, 30);
    }

    function test_NameUniqueness() public {
        _create("Zeya");
        vm.prank(relayer);
        vm.expectRevert("BitHumans: name taken");
        bh.createUser(address(this), "Zeya");
    }

    function test_CorrectAnswerWinsRegardlessOfSpeed() public {
        uint256 idA = _create("A");
        uint256 idB = _create("B");

        // A answers correctly but slowly (5000ms); B answers wrong but instantly (10ms).
        // Correctness must still win outright — speed only matters as a tiebreak.
        vm.prank(relayer);
        (uint256 winnerId, uint256 loserId) = bh.resolveWagerMatch(idA, idB, 0, 2, 2, 1, 5000, 10);

        assertEq(winnerId, idA);
        assertEq(loserId, idB);

        BitHumans.UserAcct memory winner = bh.getUser(winnerId);
        BitHumans.UserAcct memory loser = bh.getUser(loserId);
        assertEq(winner.balance, 35, "winner should net +WAGER");
        assertEq(loser.balance, 25, "loser should net -WAGER");
        assertEq(winner.wins, 1);
        assertEq(loser.losses, 1);
    }

    function test_TiedAnswersSettledBySpeed() public {
        uint256 idA = _create("A");
        uint256 idB = _create("B");

        // Both answer correctly (a tie on correctness) — A answered faster, so A wins.
        vm.prank(relayer);
        (uint256 winnerId, uint256 loserId) = bh.resolveWagerMatch(idA, idB, 0, 1, 1, 1, 1200, 3400);

        assertEq(winnerId, idA, "the faster correct answer should win a correctness tie");
        assertEq(loserId, idB);
    }

    function test_TiedWrongAnswersAlsoSettledBySpeed() public {
        uint256 idA = _create("A");
        uint256 idB = _create("B");

        // Both answer wrong (also a tie on correctness) — B answered faster this time.
        vm.prank(relayer);
        (uint256 winnerId, ) = bh.resolveWagerMatch(idA, idB, 0, 3, 1, 1, 4000, 900);

        assertEq(winnerId, idB, "the faster answer should win even when both are wrong");
    }

    function test_NeverAnsweredCannotWinASpeedTiebreak() public {
        uint256 idA = _create("A");
        uint256 idB = _create("B");

        // Both timed out (answer = 255, sentinel for "no answer"), both effectively
        // wrong. A never answered at all (max sentinel ms); B answered late but did
        // answer (14999ms, just under the 15s window). B should win.
        vm.prank(relayer);
        (uint256 winnerId, ) = bh.resolveWagerMatch(idA, idB, 0, 1, 255, 255, type(uint32).max, 14999);

        assertEq(winnerId, idB, "an agent that answered late still beats one that never answered");
    }

    function test_InsufficientBalanceReverts() public {
        uint256 idA = _create("A");
        uint256 idB = _create("B");

        // Drain A below WAGER by losing repeatedly (B always answers correctly and faster).
        for (uint256 i = 0; i < 6; i++) {
            vm.prank(relayer);
            try bh.resolveWagerMatch(idA, idB, 0, 1, 0, 1, 500, 100) {} catch {
                break;
            }
        }

        BitHumans.UserAcct memory a = bh.getUser(idA);
        assertLt(a.balance, 5, "six straight losses from a 30-cent balance should drop below WAGER");

        vm.prank(relayer);
        vm.expectRevert("BitHumans: insufficient balance");
        bh.resolveWagerMatch(idA, idB, 0, 1, 0, 1, 500, 100);
    }

    function test_DripAccruesOverTimeUpToCap() public {
        uint256 id = _create("A");
        uint256 idOpp = _create("Opp");

        // Lose four times (30 -> 10) to drop below the DRIP_CAP of 15 — losing just
        // once only reaches 25, still above the cap, so no drip would be due yet.
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(relayer);
            bh.resolveWagerMatch(idOpp, id, 0, 1, 1, 0, 100, 100); // opp correct, id (A) loses
        }

        BitHumans.UserAcct memory before = bh.getUser(id);
        assertEq(before.balance, 10);

        uint256 t0 = block.timestamp;
        vm.warp(t0 + 30);
        uint32 preview = bh.previewBalance(id);
        assertEq(preview, 11, "one drip tick should have accrued");

        // Warp far enough that the drip would exceed the cap if uncapped.
        vm.warp(t0 + 30 * 20);
        uint32 previewCapped = bh.previewBalance(id);
        assertEq(previewCapped, 15, "drip should never exceed the cap");
    }

    function test_RoyaleLocksEntriesAndPaysChampionTheWholePot() public {
        uint256 idA = _create("A");
        uint256 idB = _create("B");
        uint256 idC = _create("C");
        uint256 idD = _create("D");

        uint256[] memory ids = new uint256[](4);
        ids[0] = idA;
        ids[1] = idB;
        ids[2] = idC;
        ids[3] = idD;

        vm.prank(relayer);
        uint32 pot = bh.startRoyaleEntries(ids);
        assertEq(pot, 20, "4 entries at WAGER=5 should pool to 20");

        BitHumans.UserAcct memory a = bh.getUser(idA);
        assertEq(a.balance, 25, "entry should be deducted immediately");

        // Round resolution shouldn't move any balance.
        vm.prank(relayer);
        bh.resolveRoyaleRound(idA, idB, 0, 1, 1, 0, 200, 200); // A correct, advances
        BitHumans.UserAcct memory aAfterRound = bh.getUser(idA);
        assertEq(aAfterRound.balance, 25, "round resolution must not touch balances");

        vm.prank(relayer);
        bh.payRoyaleChampion(idA, pot);
        BitHumans.UserAcct memory champion = bh.getUser(idA);
        assertEq(champion.balance, 45, "champion should receive the entire pot on top of their remaining balance");
    }
}
